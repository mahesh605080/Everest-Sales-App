import type { PoolClient } from 'pg';
import { q, q1, pool } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { listRows } from './crud';
import { ENT } from './entities';
import { teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { fyLabel } from './bs';
import { notify, roleInTerritory, withPerm } from './notify';
import { filterSql, ListFilter } from './filters';
import { batchOffer, dispatched, fefoForOrder, recordDispatch, touchStock } from './inventory';
import { bestScheme, pricesFor, schemesFor } from './pricing';

export { fyLabel };

const CHAIN = ['asm', 'rsm', 'gm'];
const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const nptDate = async () => (await q1<any>(`select ${TODAY}::text as d`))!.d as string;
const trail = (type: string, id: number, s: Session, level: string | null, action: string, remarks?: string) =>
  q('insert into approvals(doc_type,doc_id,level,user_id,user_name,action,remarks) values($1,$2,$3,$4,$5,$6,$7)', [type, id, level, s.id, s.name, action, remarks || null]);
/** Serialises everything that reads and then changes one customer's credit or booklet balance. */
async function lockedFor<T>(customerId: number, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('begin'); await c.query('select pg_advisory_xact_lock(4711, $1)', [customerId]); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const getTrail = (type: string, id: number) => q<any>('select level,user_name,action,remarks,at from approvals where doc_type=$1 and doc_id=$2 order by at, id', [type, id]);

async function customerFor(s: Session, id: number) {
  const c = Number.isInteger(id) ? (await listRows(ENT.customers, s, { id })).rows[0] : null;
  if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.');
  return c;
}

/* ---------------- credit ---------------- */
export async function creditSnapshot(customerId: number) {
  const c = await q1<any>(
    `select c.id,c.code,c.name,c.town,c.credit_limit,c.dda_expiry,c.dda_expiry < ${TODAY} as dda_expired,
            coalesce(o.total,0) as outstanding, coalesce(o.b0,0) as b0, coalesce(o.b1,0) as b1, coalesce(o.b2,0) as b2, coalesce(o.b3,0) as b3, o.as_of,
            (${TODAY} - o.as_of) as age_days,
            (select coalesce(sum(value),0) from sales_orders so where so.customer_id=c.id and so.status='Approved') as committed,
            (select coalesce(sum(amount),0) from collections k where k.customer_id=c.id and k.status='Verified' and k.day > coalesce(o.as_of, date '1900-01-01')) as collected
       from customers c left join outstanding_balances o on o.customer_id=c.id where c.id=$1`, [customerId]);
  if (!c) throw new HttpError(404, 'Customer not found.');
  // Verified collections dated after the last upload are not yet in the uploaded outstanding, so they free up credit.
  c.available = round(c.credit_limit - c.outstanding + c.collected - c.committed);
  c.stale = c.as_of == null || c.age_days > (await setting('outstanding_stale_days', 10));
  c.instruments = await q<any>(`select id,type,bank,ref_no,amount,issue_date,expiry_date,status,remarks, expiry_date < ${TODAY} as expired, expiry_date <= ${TODAY} + 30 as expiring
                                  from financial_instruments where customer_id=$1 order by (status='Active') desc, expiry_date nulls last`, [customerId]);
  return c;
}
export async function creditFor(s: Session, id: number) {
  if (!can(s, 'credit.manage')) await customerFor(s, id);
  return creditSnapshot(id);
}
/** What Credit Control has to do today, in one call. */
export async function creditSummary() {
  const stale = await setting('outstanding_stale_days', 10);
  const r = await q1<any>(
    `select (select count(*)::int from sales_orders where status='Pending') as queue,
            (select count(*)::int from sales_orders where status='Approved') as to_dispatch,
            (select count(*)::int from collections where status='Submitted') as collections,
            (select count(*)::int from claims where status='Approved') as claims,
            (select count(*)::int from financial_instruments where status='Active' and expiry_date < ${TODAY}) as inst_expired,
            (select count(*)::int from financial_instruments where status='Active' and expiry_date between ${TODAY} and ${TODAY} + 30) as inst_expiring,
            (select coalesce(sum(total),0) from outstanding_balances) as outstanding,
            (select coalesce(sum(b3),0) from outstanding_balances) as over90,
            (select count(*)::int from customers c join outstanding_balances o on o.customer_id=c.id where c.active and c.credit_limit > 0 and o.total > c.credit_limit * 0.8) as near_limit,
            (select (${TODAY} - max(as_of)) from outstanding_uploads) as upload_age`);
  return { ...r, stale: r.upload_age == null || r.upload_age > stale };
}

export async function creditList(search: string) {
  const p: any[] = []; let w = '';
  if (search.trim()) { p.push('%' + search.trim() + '%'); w = 'and (c.name ilike $1 or c.code ilike $1 or c.town ilike $1)'; }
  return q<any>(
    `select c.id,c.code,c.name,c.town,c.type,c.credit_limit, coalesce(o.total,0) as outstanding, coalesce(o.b0,0) as b0, coalesce(o.b1,0) as b1, coalesce(o.b2,0) as b2, coalesce(o.b3,0) as b3, o.as_of,
            (select coalesce(sum(value),0) from sales_orders so where so.customer_id=c.id and so.status='Approved') as committed,
            (select count(*)::int from financial_instruments f where f.customer_id=c.id and f.status='Active') as instruments,
            (select min(expiry_date) from financial_instruments f where f.customer_id=c.id and f.status='Active') as next_expiry, u.name as assigned
       from customers c left join outstanding_balances o on o.customer_id=c.id
       left join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null left join users u on u.id=ca.user_id
      where c.active ${w} order by (coalesce(o.total,0) / nullif(c.credit_limit,0)) desc nulls last, c.name limit 500`, p);
}
export async function setLimit(s: Session, b: any, ip: string | null) {
  const limit = Number(b.limit), id = Number(b.customer_id);
  if (!Number.isFinite(limit) || limit < 0) throw new HttpError(422, 'Credit limit must be a number, zero or more.');
  const before = await q1<any>('select id, credit_limit from customers where id=$1', [id]);
  if (!before) throw new HttpError(404, 'Customer not found.');
  await q('update customers set credit_limit=$1, updated_at=now(), updated_by=$2 where id=$3', [round(limit), s.id, id]);
  await audit(s, 'credit-limit', 'customers', id, { credit_limit: before.credit_limit }, { credit_limit: round(limit), remarks: String(b.remarks || '').slice(0, 200) }, ip);
  return { ok: true };
}
const INST_TYPES = ['Bank Guarantee', 'Letter of Credit', 'Cheque (PDC)', 'Director Approval'], INST_STATUS = ['Active', 'Deposited', 'Cleared', 'Bounced', 'Released'];
export async function saveInstrument(s: Session, b: any, ip: string | null) {
  const date = (v: any) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (b.id) {
    if (!INST_STATUS.includes(b.status)) throw new HttpError(422, 'Choose a status.');
    const before = await q1<any>('select * from financial_instruments where id=$1', [Number(b.id)]);
    if (!before) throw new HttpError(404, 'Instrument not found.');
    await q('update financial_instruments set status=$1, updated_at=now() where id=$2', [b.status, before.id]);
    await audit(s, 'update', 'financial_instruments', before.id, { status: before.status }, { status: b.status }, ip);
    return { ok: true };
  }
  const amount = Number(b.amount);
  if (!INST_TYPES.includes(b.type)) throw new HttpError(422, 'Choose the instrument type.');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(422, 'Amount must be more than zero.');
  if (!date(b.expiry_date)) throw new HttpError(422, b.type === 'Cheque (PDC)' ? 'Enter the cheque date.' : 'Enter the expiry date.');
  if (!(await q1('select 1 from customers where id=$1', [Number(b.customer_id)]))) throw new HttpError(404, 'Customer not found.');
  const row = await q1<any>('insert into financial_instruments(customer_id,type,bank,ref_no,amount,issue_date,expiry_date,remarks,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
    [Number(b.customer_id), b.type, String(b.bank || '').slice(0, 100) || null, String(b.ref_no || '').slice(0, 60) || null, round(amount), date(b.issue_date), date(b.expiry_date), String(b.remarks || '').slice(0, 300) || null, s.id]);
  await audit(s, 'create', 'financial_instruments', row.id, null, row, ip);
  return { id: row.id };
}

/* ---------------- booklets ---------------- */
async function expire() {
  await q(`update booklets set status='Expired', level=null, updated_at=now() where status in ('Pending','Accepted') and due_date < ${TODAY}`);
}
const BK_SELECT = `select b.*, c.name as customer, c.code as customer_code, c.town, u.name as person, u.code as person_code, a.name as area
  from booklets b join customers c on c.id=b.customer_id join users u on u.id=b.user_id left join areas a on a.id=u.area_id`;

export async function listBooklets(s: Session, box: string, customerId?: number, f?: ListFilter) {
  await expire();
  const p: any[] = []; let w = '';
  if (box === 'mine') { p.push(s.id); w = 'b.user_id=$1'; }
  else if (box === 'inbox') { p.push(s.role); w = `b.status='Pending' and b.level=$1 and b.user_id <> ${s.id}` + teamScope(s, p); }
  else if (box === 'usable') { p.push(customerId); w = `b.status='Accepted' and b.customer_id=$1`; if (!can(s, 'credit.manage')) await customerFor(s, Number(customerId)); }
  else if (box === 'accepted') { if (!can(s, 'credit.manage')) throw new HttpError(403, 'Your role does not allow this.'); w = `b.status='Accepted'`; }
  else { if (!can(s, 'sales.view')) throw new HttpError(403, 'Your role does not allow this.'); w = 'true' + teamScope(s, p); }
  w += filterSql(p, f, { status: 'b.status', text: ['b.no', 'c.name', 'u.name'], date: 'b.order_date' });
  return q<any>(`${BK_SELECT} where ${w} order by b.created_at desc limit 300`, p);
}

async function bookletItems(id: number) {
  return q<any>(
    `select i.*, p.code as product_code, p.name as product, p.generic_name, p.pack_size, p.units_per_box,
            i.qty - coalesce((select sum(oi.qty) from sales_order_items oi join sales_orders o on o.id=oi.order_id
                               where o.booklet_id=i.booklet_id and oi.product_id=i.product_id and o.status not in ('Rejected','Withdrawn')),0)::int as balance
       from booklet_items i join products p on p.id=i.product_id where i.booklet_id=$1 order by i.id`, [id]);
}
async function bookletVisible(s: Session, id: number) {
  await expire();
  const b = Number.isInteger(id) ? await q1<any>(`${BK_SELECT} where b.id=$1`, [id]) : null;
  if (!b) throw new HttpError(404, 'Booklet not found.');
  if (b.user_id === s.id || can(s, 'credit.manage')) return b;
  const p: any[] = [b.user_id]; const scope = teamScope(s, p);
  if (s.level >= 2 && (can(s, 'sales.view') || can(s, 'booklets.approve')) && (await q1(`select 1 from users u where u.id=$1${scope}`, p))) return b;
  throw new HttpError(404, 'Booklet not found.');
}
export async function getBooklet(s: Session, id: number) {
  const b = await bookletVisible(s, id);
  return { booklet: b, items: await bookletItems(id), trail: await getTrail('booklet', id), credit: await creditSnapshot(b.customer_id),
    canDecide: b.status === 'Pending' && b.level === s.role && b.user_id !== s.id && can(s, 'booklets.approve'), canCancel: b.status === 'Accepted' && can(s, 'credit.manage') };
}

export async function createBooklet(s: Session, body: any, ip: string | null) {
  const cust = await customerFor(s, Number(body.customer_id));
  const today = await nptDate(), due = String(body.due_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today) throw new HttpError(422, 'The valid-to date must be today or later.');
  if (Date.parse(due) - Date.parse(today) > 60 * 864e5) throw new HttpError(422, 'A booklet can be valid for at most 60 days.');
  const lines: any[] = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) throw new HttpError(422, 'Add at least one product.');
  if (lines.length > 50) throw new HttpError(422, 'A booklet can have at most 50 products.');
  const items: any[] = [], seen = new Set<number>(), list = await pricesFor(cust);
  for (const [n, l] of lines.entries()) {
    const at = `Line ${n + 1}: `, p = await q1<any>('select * from products where id=$1 and active', [Number(l.product_id)]);
    if (!p) throw new HttpError(422, at + 'choose a product.');
    if (seen.has(p.id)) throw new HttpError(422, at + `${p.name} is on the booklet twice.`); seen.add(p.id);
    const base = list.get(p.id)?.rate ?? p.trade_rate; // the customer's own price list is the base, not the general trade rate
    const qty = Number(l.qty), ask = Number(l.ask_rate), buy = Number(l.bonus_buy) || 0, free = Number(l.bonus_free) || 0, disc = Number(l.discount_pct) || 0;
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(422, at + 'boxes must be a whole number above zero.');
    if (!Number.isFinite(ask) || ask <= 0) throw new HttpError(422, at + 'ask rate must be above zero.');
    if (!Number.isInteger(buy) || !Number.isInteger(free) || buy < 0 || free < 0 || (free > 0 && buy <= 0)) throw new HttpError(422, at + 'bonus needs a buy quantity and a free quantity, for example 10 + 1.');
    if (disc < 0 || disc >= 100) throw new HttpError(422, at + 'discount must be between 0 and 99.99%.');
    if (p.mrp > 0 && ask > p.mrp) throw new HttpError(422, at + `ask rate ${ask} is above the MRP of ${p.mrp}.`);
    if (p.trade_rate <= 0) throw new HttpError(422, at + `${p.name} has no trade rate in the product master.`);
    const net = ask * (1 - disc / 100) * (free > 0 ? buy / (buy + free) : 1), variance = (base - net) / base * 100;
    const remarks = String(l.remarks || '').trim();
    if (variance > 0.005 && !remarks) throw new HttpError(422, at + 'give a reason for a rate below the base rate.');
    items.push({ p, base, qty, ask: round(ask), buy, free, disc: round(disc), net: round(net, 4), variance: round(variance), remarks });
  }
  const maxVar = Math.max(...items.map(i => i.variance));
  const bandA = await setting('booklet_asm_band_pct', 2), bandR = await setting('booklet_rsm_band_pct', 5);
  const bandIdx = maxVar <= bandA ? 0 : maxVar <= bandR ? 1 : 2;
  // Nobody approves their own booklet: an ASM's booklet starts with the RSM.
  const startIdx = s.role === 'asm' ? 1 : s.role === 'rsm' ? 2 : 0, finalIdx = Math.max(bandIdx, startIdx);
  const c = await pool.connect();
  try {
    await c.query('begin');
    const seq = (await c.query(`select nextval('booklet_no_seq') n`)).rows[0].n;
    const no = `BK-${fyLabel(today)}-${String(seq).padStart(4, '0')}`;
    const b = (await c.query(`insert into booklets(no,user_id,customer_id,order_date,due_date,remarks,level,final_level,max_variance) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [no, s.id, cust.id, today, due, String(body.remarks || '').slice(0, 500) || null, CHAIN[startIdx], CHAIN[finalIdx], maxVar])).rows[0];
    for (const i of items) await c.query(`insert into booklet_items(booklet_id,product_id,qty,base_rate,ask_rate,bonus_buy,bonus_free,discount_pct,net_rate,variance_pct,remarks) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [b.id, i.p.id, i.qty, i.base, i.ask, i.buy, i.free, i.disc, i.net, i.variance, i.remarks || null]);
    await c.query('insert into approvals(doc_type,doc_id,level,user_id,user_name,action) values($1,$2,$3,$4,$5,$6)', ['booklet', b.id, null, s.id, s.name, 'Submitted']);
    await c.query('commit');
    await audit(s, 'create', 'booklets', b.id, null, { no, customer: cust.name, max_variance: maxVar }, ip);
    await notify(await roleInTerritory(CHAIN[startIdx], s.id), `Booklet ${no} needs your approval`, `${s.name} · ${cust.name} · ${maxVar.toFixed(1)}% below base`, '/booklets');
    return { id: b.id, no, level: CHAIN[startIdx], final_level: CHAIN[finalIdx] };
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

export async function actBooklet(s: Session, id: number, b: any, ip: string | null) {
  const bk = await bookletVisible(s, id); const remarks = String(b.remarks || '').trim().slice(0, 500);
  let status = bk.status, level = bk.level, action = '';
  if (b.action === 'cancel') {
    if (!can(s, 'credit.manage')) throw new HttpError(403, 'Only Credit Control can cancel a booklet.');
    if (bk.status !== 'Accepted') throw new HttpError(409, 'Only an accepted booklet can be cancelled.');
    if (!remarks) throw new HttpError(422, 'Give a reason for cancelling.');
    status = 'Cancelled'; level = null; action = 'Cancelled by Credit Control';
  } else {
    if (!can(s, 'booklets.approve') || bk.status !== 'Pending' || bk.level !== s.role || bk.user_id === s.id) throw new HttpError(403, 'This booklet is not waiting for you.');
    if (b.action === 'approve') {
      if (bk.level === bk.final_level) { status = 'Accepted'; level = null; action = 'Approved (final)'; }
      else { level = CHAIN[CHAIN.indexOf(bk.level) + 1]; action = 'Approved'; }
    } else if (b.action === 'reject' || b.action === 'back') {
      if (!remarks) throw new HttpError(422, 'Remarks are needed to reject or send back.');
      status = b.action === 'reject' ? 'Rejected' : 'Sent back'; level = null; action = b.action === 'reject' ? 'Rejected' : 'Sent back';
    } else throw new HttpError(422, 'Unknown action.');
  }
  await q('update booklets set status=$1, level=$2, updated_at=now() where id=$3', [status, level, id]);
  await trail('booklet', id, s, bk.level, action, remarks);
  await notify([bk.user_id], `Booklet ${bk.no}: ${action.toLowerCase()}`, `${s.name}${remarks ? ' · ' + remarks : ''}`, '/booklets');
  if (status === 'Pending' && level) await notify(await roleInTerritory(level, bk.user_id), `Booklet ${bk.no} needs your approval`, `${bk.person} · ${bk.customer}`, '/booklets');
  await audit(s, action.toLowerCase(), 'booklets', id, { status: bk.status, level: bk.level }, { status, level, remarks }, ip);
  return { status, level };
}

/* ---------------- sales orders ---------------- */
const SO_SELECT = `select o.*, c.name as customer, c.code as customer_code, c.town, u.name as person, u.code as person_code, a.name as area, t.name as term, b.no as booklet_no, d.name as decided_by_name
  from sales_orders o join customers c on c.id=o.customer_id join users u on u.id=o.user_id left join areas a on a.id=u.area_id
  left join payment_terms t on t.id=o.payment_term_id left join booklets b on b.id=o.booklet_id left join users d on d.id=o.decided_by`;

export async function listOrders(s: Session, box: string, f?: ListFilter) {
  const p: any[] = []; let w = '';
  if (box === 'mine') { p.push(s.id); w = 'o.user_id=$1'; }
  else if (box === 'queue' || box === 'approved') { if (!can(s, 'credit.manage') && !can(s, 'dispatch.manage')) throw new HttpError(403, 'Your role does not allow this.'); w = box === 'queue' ? `o.status='Pending'` : `o.status='Approved'`; }
  else { if (!can(s, 'sales.view')) throw new HttpError(403, 'Your role does not allow this.'); w = 'true' + (can(s, 'credit.manage') ? '' : teamScope(s, p)); }
  w += filterSql(p, f, { status: 'o.status', text: ['o.no', 'c.name', 'u.name'], date: 'o.order_date' });
  const rows = await q<any>(`${SO_SELECT} where ${w} order by ${box === 'queue' ? 'o.created_at' : 'o.created_at desc'} limit 300`, p);
  if (box === 'queue') for (const r of rows) { const c = await creditSnapshot(r.customer_id); r.available = c.available; r.over_now = r.value > c.available; r.stale = c.stale; r.dda_expired = c.dda_expired; }
  return rows;
}
async function orderVisible(s: Session, id: number) {
  const o = Number.isInteger(id) ? await q1<any>(`${SO_SELECT} where o.id=$1`, [id]) : null;
  if (!o) throw new HttpError(404, 'Sales order not found.');
  if (o.user_id === s.id || can(s, 'credit.manage') || can(s, 'dispatch.manage')) return o;
  const p: any[] = [o.user_id]; const scope = teamScope(s, p);
  if (s.level >= 2 && can(s, 'sales.view') && (await q1(`select 1 from users u where u.id=$1${scope}`, p))) return o;
  throw new HttpError(404, 'Sales order not found.');
}
export async function getOrder(s: Session, id: number) {
  const o = await orderVisible(s, id), credit = await creditSnapshot(o.customer_id);
  const items = await q<any>('select i.*, p.code as product_code, p.name as product, p.generic_name, p.pack_size from sales_order_items i join products p on p.id=i.product_id where i.order_id=$1 order by i.id', [id]);
  if (o.status === 'Approved' || o.status === 'Pending') await fefoForOrder(items);
  if (o.status === 'Dispatched') { const sent = await dispatched(id); for (const i of items) i.sent = sent.filter(x => x.order_item_id === i.id); }
  return { order: { ...o, over_now: o.status === 'Pending' && o.value > credit.available }, items, trail: await getTrail('order', id), credit,
    canDecide: o.status === 'Pending' && can(s, 'credit.manage'), canWithdraw: o.status === 'Pending' && o.user_id === s.id, canDispatch: o.status === 'Approved' && can(s, 'dispatch.manage') };
}

export async function createOrder(s: Session, body: any, ip: string | null) {
  await expire();
  const cust = await customerFor(s, Number(body.customer_id)), today = await nptDate();
  const lines: any[] = (Array.isArray(body.items) ? body.items : []).filter((l: any) => Number(l.qty) > 0);
  if (!lines.length) throw new HttpError(422, 'Add at least one product with a quantity.');
  const out = await lockedFor(cust.id, async c => {
  let bk: any = null, bkItems: any[] = [];
  if (body.booklet_id) {
    bk = await q1<any>(`select * from booklets where id=$1 and customer_id=$2 and status='Accepted'`, [Number(body.booklet_id), cust.id]);
    if (!bk) throw new HttpError(422, 'That booklet is not accepted for this customer, or it has expired.');
    bkItems = await bookletItems(bk.id);
  }
  const items: any[] = [], seen = new Set<number>(); let value = 0;
  const prices = bk ? new Map<number, any>() : await pricesFor(cust), schemes = bk ? [] : await schemesFor(cust);
  for (const [n, l] of lines.entries()) {
    const at = `Line ${n + 1}: `, p = await q1<any>('select * from products where id=$1 and active', [Number(l.product_id)]), qty = Number(l.qty);
    if (!p) throw new HttpError(422, at + 'choose a product.');
    const lot = l.batch_id ? Number(l.batch_id) : 0;
    if (seen.has(p.id * 100000 + lot)) throw new HttpError(422, at + `${p.name} is on the order twice.`); seen.add(p.id * 100000 + lot);
    if (!Number.isInteger(qty)) throw new HttpError(422, at + 'boxes must be a whole number.');
    let rate = p.trade_rate, batch: any = null, listRate = p.trade_rate, source = 'trade', sch: any = null, free = 0;
    if (lot) {
      // A near-expiry lot: the price comes from the offer slab, no booklet is needed, and it is sold as non-returnable.
      if (bk) throw new HttpError(422, at + 'a near-expiry lot cannot be put on a booklet order. Use a separate order.');
      batch = await batchOffer(lot);
      if (batch.product_id !== p.id) throw new HttpError(422, at + 'that batch is a different product.');
      if (!batch.offer) throw new HttpError(422, at + (batch.expired ? `batch ${batch.batch_no} has expired and cannot be sold.` : batch.unsellable ? `batch ${batch.batch_no} has less shelf life left than the minimum in Settings.` : `batch ${batch.batch_no} is not near expiry, so it has no offer price.`));
      if (qty > batch.free_boxes) throw new HttpError(422, at + `only ${batch.free_boxes} boxes of batch ${batch.batch_no} are left.`);
      rate = batch.offer.rate; source = 'lot';
    }
    if (bk) {
      const bi = bkItems.find(x => x.product_id === p.id);
      if (!bi) throw new HttpError(422, at + `${p.name} is not on booklet ${bk.no}. Use a separate order at standard rates.`);
      if (qty > bi.balance) throw new HttpError(422, at + `only ${bi.balance} boxes of ${p.name} are left on booklet ${bk.no}.`);
      rate = bi.net_rate; source = 'booklet';
    }
    if (!lot && !bk) {
      // Standard order line: the customer's own price list first, then the best running scheme. A contract rate takes no scheme on top.
      const pr = prices.get(p.id); if (pr) { rate = listRate = pr.rate; source = pr.source; }
      const g = source === 'customer' ? null : bestScheme(schemes, p.id, qty, p.units_per_box, rate);
      if (g) { sch = g.scheme; free = g.free; rate = round(rate * (1 - g.disc / 100), 4); }
    }
    const v = round(qty * p.units_per_box * rate); value += v;
    items.push({ p, qty, rate, v, batch, listRate, source, sch, free });
  }
  value = round(value);
  const credit = await creditSnapshot(cust.id), over = value > credit.available;
  const term = body.payment_term_id ? await q1<any>('select id from payment_terms where id=$1 and active', [Number(body.payment_term_id)]) : null;
  const txt = (v: any, n: number) => String(v || '').trim().slice(0, n) || null;
  {
    const seq = (await c.query(`select nextval('sales_order_no_seq') n`)).rows[0].n, no = `SO-${fyLabel(today)}-${String(seq).padStart(4, '0')}`;
    const o = (await c.query(
      `insert into sales_orders(no,user_id,customer_id,booklet_id,order_date,payment_term_id,delivery_address,contact_person,contact_phone,transport,transporter,vehicle_no,remarks,value,over_limit)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [no, s.id, cust.id, bk?.id ?? null, today, term?.id ?? cust.payment_term_id ?? null, txt(body.delivery_address, 300) ?? cust.address ?? null, txt(body.contact_person, 100) ?? cust.contact_person ?? null,
        txt(body.contact_phone, 30) ?? cust.phone ?? null, body.transport === 'Customer' ? 'Customer' : 'Company', txt(body.transporter, 100), txt(body.vehicle_no, 30), txt(body.remarks, 500), value, over])).rows[0];
    for (const i of items) await c.query('insert into sales_order_items(order_id,product_id,qty,units_per_box,rate,value,batch_id,batch_no,expiry_date,non_returnable,list_rate,scheme_id,scheme_text,free_qty,price_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [o.id, i.p.id, i.qty, i.p.units_per_box, i.rate, i.v, i.batch?.id ?? null, i.batch?.batch_no ?? null, i.batch?.expiry_date ?? null, !!i.batch, i.listRate, i.sch?.id ?? null, i.sch ? `${i.sch.code}: ${i.sch.text}` : null, i.free, i.source]);
    await c.query('insert into approvals(doc_type,doc_id,user_id,user_name,action,remarks) values($1,$2,$3,$4,$5,$6)', ['order', o.id, s.id, s.name, 'Submitted', over ? 'Over credit limit at submission' : null]);
    return { id: o.id as number, no, value, over_limit: over, dda_expired: credit.dda_expired as boolean, customer: cust.name as string };
  }
  });
  touchStock();
  await audit(s, 'create', 'sales_orders', out.id, null, { no: out.no, customer: out.customer, value: out.value, over_limit: out.over_limit }, ip);
  await notify(await withPerm('credit.manage'), `Sales order ${out.no} is waiting${out.over_limit ? ' (over limit)' : ''}`, `${s.name} · ${out.customer} · Rs ${Math.round(out.value).toLocaleString('en-IN')}`, '/credit');
  return out;
}


export async function actOrder(s: Session, id: number, b: any, ip: string | null) {
  const o = await orderVisible(s, id), remarks = String(b.remarks || '').trim().slice(0, 500);
  let status = o.status, action = '';
  if (b.action === 'withdraw') {
    if (o.user_id !== s.id || o.status !== 'Pending') throw new HttpError(409, 'Only your own pending order can be withdrawn.');
    status = 'Withdrawn'; action = 'Withdrawn';
  } else if (b.action === 'approve' || b.action === 'reject') {
    if (!can(s, 'credit.manage')) throw new HttpError(403, 'Only Credit Control can approve or reject an order.');
    if (o.status !== 'Pending') throw new HttpError(409, 'This order is no longer pending.');
    if (b.action === 'reject') { if (!remarks) throw new HttpError(422, 'Remarks are needed to reject.'); status = 'Rejected'; action = 'Rejected'; }
    else {
      // Two approvals for the same customer are checked one after the other, never both against the same free credit.
      action = await lockedFor(o.customer_id, async c => {
        const credit = await creditSnapshot(o.customer_id), over = o.value > credit.available;
        if (over && !remarks) throw new HttpError(422, 'This order is over the credit limit. Name the instrument or director approval that covers it in the remarks.');
        const done = await c.query(`update sales_orders set status='Approved', decided_by=$1, decided_at=now(), updated_at=now() where id=$2 and status='Pending'`, [s.id, id]);
        if (!done.rowCount) throw new HttpError(409, 'Someone else has just decided this order.');
        return over ? 'Approved over limit' : 'Approved';
      });
      status = 'Approved';
    }
    if (status === 'Rejected') await q('update sales_orders set decided_by=$1, decided_at=now() where id=$2', [s.id, id]);
  } else if (b.action === 'dispatch') {
    if (!can(s, 'dispatch.manage')) throw new HttpError(403, 'Your role cannot mark orders dispatched.');
    if (o.status !== 'Approved') throw new HttpError(409, 'Only an approved order can be dispatched.');
    status = 'Dispatched'; action = 'Dispatched';
    await recordDispatch(id, o.customer_id);
    await q('update sales_orders set invoice_no=$1, dispatched_by=$2, dispatched_at=now() where id=$3', [String(b.invoice_no || '').trim().slice(0, 40) || null, s.id, id]);
  } else throw new HttpError(422, 'Unknown action.');
  await q('update sales_orders set status=$1, updated_at=now() where id=$2', [status, id]);
  touchStock();
  await trail('order', id, s, null, action, remarks || (b.invoice_no ? `Invoice ${b.invoice_no}` : ''));
  if (o.user_id !== s.id) await notify([o.user_id], `Sales order ${o.no}: ${action.toLowerCase()}`, `${o.customer}${remarks ? ' · ' + remarks : ''}`, '/orders');
  if (status === 'Approved') await notify(await withPerm('dispatch.manage'), `Sales order ${o.no} is ready for dispatch`, o.customer, '/credit');
  await audit(s, action.toLowerCase(), 'sales_orders', id, { status: o.status }, { status, remarks }, ip);
  return { status };
}

/** One row per order line for the people who key approved orders into the accounting software. */
export async function exportRows(day: string) {
  return q<any>(
    `select o.no, o.order_date, c.code as customer_code, c.name as customer, p.code as product_code, p.name as product, i.qty as boxes, i.free_qty as free_boxes, i.units_per_box, i.rate, i.value, coalesce(i.scheme_text,'') as scheme, coalesce(i.batch_no,'') as batch, i.non_returnable, t.name as payment_term, o.transport, b.no as booklet_no, u.code as sales_officer
       from sales_orders o join sales_order_items i on i.order_id=o.id join products p on p.id=i.product_id join customers c on c.id=o.customer_id join users u on u.id=o.user_id
       left join payment_terms t on t.id=o.payment_term_id left join booklets b on b.id=o.booklet_id
      where o.status in ('Approved','Dispatched') and (o.decided_at at time zone 'Asia/Kathmandu')::date = $1::date order by o.no, i.id`, [day]);
}
