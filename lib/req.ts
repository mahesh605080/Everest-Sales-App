import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { listRows } from './crud';
import { ENT } from './entities';
import { teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { REQ, ReqDef, RField } from './reqdefs';
import { managerOf, notify, withPerm } from './notify';
import { filterSql, ListFilter } from './filters';
import { checkClaim } from './returns';

export function reqDef(key: string): ReqDef {
  const d = REQ[key]; if (!d) throw new HttpError(404, 'Unknown list.'); return d;
}
const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);
const round = (n: number) => Math.round(n * 100) / 100;
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

function coerce(f: RField, raw: any) {
  const empty = raw === undefined || raw === null || String(raw).trim() === '';
  if (empty) { if (f.required) throw new HttpError(422, `${f.label} is required.`); return f.type === 'money' ? 0 : null; }
  switch (f.type) {
    case 'text': return String(raw).trim().slice(0, 500);
    case 'money': { const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new HttpError(422, `${f.label} must be a number, zero or more.`); return round(n); }
    case 'int': case 'customer': case 'product': case 'photo': { const n = Number(raw); if (!Number.isInteger(n) || n <= 0) throw new HttpError(422, `${f.label} is not valid.`); return n; }
    case 'date': if (!isDate(raw)) throw new HttpError(422, `${f.label} must be a date.`); return raw;
    case 'select': if (!f.options!.includes(raw)) throw new HttpError(422, `Choose ${f.label.toLowerCase()}.`); return raw;
  }
}

export async function createReq(def: ReqDef, s: Session, body: any, ip: string | null) {
  const v: Record<string, any> = {};
  for (const f of def.fields) v[f.key] = coerce(f, body[f.key]);
  const today = (await q1<any>(`select ${TODAY}::text d`))!.d as string;
  if (v.customer_id) { const c = (await listRows(ENT.customers, s, { id: v.customer_id })).rows[0]; if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.'); }
  if (v.product_id && !(await q1('select 1 from products where id=$1 and active', [v.product_id]))) throw new HttpError(422, 'Choose a product from the list.');
  if (v.photo_id && !(await q1('select 1 from photos where id=$1 and user_id=$2', [v.photo_id, s.id]))) throw new HttpError(422, 'The photo could not be found. Attach it again.');

  if (def.key === 'collections') {
    if (v.amount <= 0) throw new HttpError(422, 'Amount must be more than zero.');
    if (v.mode === 'Cheque' && (!v.ref_no || !v.cheque_date)) throw new HttpError(422, 'A cheque needs its number and date.');
    v.day = today;
  }
  if (def.key === 'samples') { if (v.kind === 'Sample' ? !v.product_id : !v.item) throw new HttpError(422, v.kind === 'Sample' ? 'Choose the product that was sampled.' : 'Say what item was given.'); v.day = today; }
  if (def.key === 'competitor') v.day = today;
  if (def.key === 'claims') {
    if (v.amount <= 0) throw new HttpError(422, 'Claim amount must be more than zero.'); v.day = today;
    v.flags = JSON.stringify(await checkClaim(v));
  }
  if ((def.key === 'collections' || def.key === 'claims') && typeof body.client_ref === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.client_ref)) {
    const had = await q1<any>(`select id from ${def.table} where user_id=$1 and client_ref=$2`, [s.id, body.client_ref]);
    if (had) return { id: had.id, duplicate: true }; // sent again after a lost connection
    v.client_ref = body.client_ref;
  }
  const keys = Object.keys(v);
  const row = await q1<any>(`insert into ${def.table}(user_id,${keys.map(k => `"${k}"`).join(',')}) values($1,${keys.map((_, i) => '$' + (i + 2)).join(',')}) returning id`, [s.id, ...keys.map(k => v[k])]);
  await q('insert into approvals(doc_type,doc_id,user_id,user_name,action) values($1,$2,$3,$4,$5)', [def.key, row!.id, s.id, s.name, def.steps.length ? 'Submitted' : 'Recorded']);
  await audit(s, 'create', def.key, row!.id, null, v, ip);
  const first = def.steps[0];
  if (first) await notify(first.scope === 'team' ? [await managerOf(s.id)] : await withPerm(first.perm), `New ${def.one} from ${s.name}`, v.amount != null ? `Rs ${v.amount}` : null, `/r/${def.key}`);
  if (def.key === 'claims' && String(v.flags).includes('over_cap')) await notify((await q<any>(`select u.id from users u join roles r on r.id=u.role_id where u.active and r.key='gm'`)).map(g => g.id), `Claim over the yearly returns limit from ${s.name}`, `Rs ${v.amount}`, '/r/claims');
  return { id: row!.id };
}

function selectSql(def: ReqDef) {
  const hasC = def.fields.some(f => f.type === 'customer'), hasP = def.fields.some(f => f.type === 'product');
  return `select t.*, u.name as person, u.code as person_code, a.name as area${hasC ? ', c.name as customer, c.code as customer_code' : ''}${hasP ? ', p.name as product' : ''}
            from ${def.table} t join users u on u.id=t.user_id left join areas a on a.id=u.area_id${hasC ? ' left join customers c on c.id=t.customer_id' : ''}${hasP ? ' left join products p on p.id=t.product_id' : ''}`;
}
const mySteps = (def: ReqDef, s: Session) => def.steps.filter(st => can(s, st.perm));

export async function listReq(def: ReqDef, s: Session, box: string, f?: ListFilter) {
  const p: any[] = []; let w: string;
  if (box === 'mine') { p.push(s.id); w = 't.user_id=$1'; }
  else {
    const steps = mySteps(def, s);
    if (!steps.length && !(def.view && can(s, def.view))) throw new HttpError(403, 'Your role does not allow this.');
    const all = steps.some(st => st.scope === 'all');
    if (box === 'inbox') {
      const parts = steps.map(st => { p.push(st.from); return `(t.status=$${p.length}${st.scope === 'team' ? ` and t.user_id <> ${s.id}` + teamScope(s, p) : ''})`; });
      w = parts.length ? '(' + parts.join(' or ') + ')' : 'false';
    } else w = 'true' + (all ? '' : teamScope(s, p));
  }
  w += filterSql(p, f, { status: 't.status', text: def.fields.some(x => x.type === 'customer') ? ['u.name', 'c.name'] : ['u.name'], date: 't.day' });
  const rows = await q<any>(`${selectSql(def)} where ${w} order by t.created_at desc limit 300`, p);
  const ids = rows.map(r => r.id);
  const trails = ids.length ? await q<any>('select doc_id,user_name,action,remarks,at from approvals where doc_type=$1 and doc_id = any($2) order by at, id', [def.key, ids]) : [];
  for (const r of rows) {
    r.trail = trails.filter(t => t.doc_id === r.id);
    const st = def.steps.find(x => x.from === r.status && can(s, x.perm));
    r.next = st && (st.scope === 'all' || r.user_id !== s.id) ? st.label : null;
    if (def.key === 'claims' && r.status === 'Submitted' && s.level < 4 && Array.isArray(r.flags) && r.flags.some((f: any) => f.k === 'over_cap')) r.next = null; // only the General Manager decides these
  }
  return rows;
}

export async function actReq(def: ReqDef, s: Session, id: number, b: any, ip: string | null) {
  const row = Number.isInteger(id) ? await q1<any>(`select * from ${def.table} where id=$1`, [id]) : null;
  if (!row) throw new HttpError(404, `This ${def.one} no longer exists.`);
  const remarks = String(b.remarks || '').trim().slice(0, 500);
  if (b.action === 'withdraw') {
    if (row.user_id !== s.id || row.status !== 'Submitted') throw new HttpError(409, 'Only your own request that nobody has acted on can be withdrawn.');
    await q(`update ${def.table} set status='Withdrawn', updated_at=now() where id=$1`, [id]);
    await q('insert into approvals(doc_type,doc_id,user_id,user_name,action) values($1,$2,$3,$4,$5)', [def.key, id, s.id, s.name, 'Withdrawn']);
    return { status: 'Withdrawn', message: 'Withdrawn.' };
  }
  const st = def.steps.find(x => x.from === row.status && can(s, x.perm));
  if (!st) throw new HttpError(403, `This ${def.one} is not waiting for you.`);
  if (st.scope === 'team') {
    if (row.user_id === s.id) throw new HttpError(403, 'You cannot decide your own request.');
    const p: any[] = [row.user_id]; const scope = teamScope(s, p);
    if (!(await q1(`select 1 from users u where u.id=$1${scope}`, p))) throw new HttpError(403, 'This person is not in your team.');
  }
  if (def.key === 'claims' && row.status === 'Submitted' && b.action === 'next' && Array.isArray(row.flags) && row.flags.length) {
    if (row.flags.some((f: any) => f.k === 'over_cap') && s.level < 4) throw new HttpError(403, 'This claim is over the customer\'s yearly returns limit. Only the General Manager can approve it.');
    if (!remarks) throw new HttpError(422, 'The policy check raised points on this claim. Write in the remarks why it is being approved.');
  }
  let status: string, action: string;
  if (b.action === 'reject') { if (!remarks) throw new HttpError(422, 'Remarks are needed to reject.'); status = 'Rejected'; action = 'Rejected'; }
  else if (b.action === 'next') { status = st.to; action = st.to; }
  else throw new HttpError(422, 'Unknown action.');
  await q(`update ${def.table} set status=$1, updated_at=now() where id=$2`, [status, id]);
  await q('insert into approvals(doc_type,doc_id,user_id,user_name,action,remarks) values($1,$2,$3,$4,$5,$6)', [def.key, id, s.id, s.name, action, remarks || null]);
  await audit(s, action.toLowerCase(), def.key, id, { status: row.status }, { status, remarks }, ip);
  await notify([row.user_id], `Your ${def.one}: ${status.toLowerCase()}`, `${s.name}${remarks ? ' · ' + remarks : ''}`, `/r/${def.key}`);
  const nxt = def.steps.find(x => x.from === status);
  if (nxt && nxt.scope === 'all') await notify(await withPerm(nxt.perm), `${def.one[0].toUpperCase() + def.one.slice(1)} approved, waiting for you`, null, `/r/${def.key}`);
  return { status, message: status === 'Rejected' ? 'Rejected.' : st.done };
}

/* ---------------- distributor stock ---------------- */
export async function stockForm(s: Session, customerId: number) {
  const c = (await listRows(ENT.customers, s, { id: customerId })).rows[0];
  if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.');
  const last = await q1<any>('select id, day from stock_reports where customer_id=$1 order by day desc limit 1', [customerId]);
  const items = last ? await q<any>('select product_id, stock, sold_30d, near_expiry from stock_report_items where report_id=$1', [last.id]) : [];
  return { last_day: last?.day ?? null, items };
}
export async function saveStock(s: Session, b: any, ip: string | null) {
  const cid = Number(b.customer_id), c = (await listRows(ENT.customers, s, { id: cid })).rows[0];
  if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.');
  const items = (Array.isArray(b.items) ? b.items : []).map((i: any) => ({ p: Number(i.product_id), stock: Number(i.stock) || 0, sold: Number(i.sold_30d) || 0, exp: Number(i.near_expiry) || 0 }))
    .filter((i: any) => i.stock > 0 || i.sold > 0 || i.exp > 0);
  if (!items.length) throw new HttpError(422, 'Enter stock or sales for at least one product.');
  for (const i of items) {
    if (![i.stock, i.sold, i.exp].every(n => Number.isInteger(n) && n >= 0)) throw new HttpError(422, 'Quantities must be whole boxes, zero or more.');
    if (i.exp > i.stock) throw new HttpError(422, 'Near-expiry boxes cannot be more than the stock.');
  }
  const rep = await q1<any>(`insert into stock_reports(user_id,customer_id,day) values($1,$2,${TODAY}) on conflict(customer_id,day) do update set user_id=excluded.user_id, created_at=now() returning id`, [s.id, cid]);
  await q('delete from stock_report_items where report_id=$1', [rep!.id]);
  for (const i of items) await q('insert into stock_report_items(report_id,product_id,stock,sold_30d,near_expiry) values($1,$2,$3,$4,$5)', [rep!.id, i.p, i.stock, i.sold, i.exp]);
  await audit(s, 'stock-report', 'stock_reports', rep!.id, null, { customer: c.name, lines: items.length }, ip);
  return { ok: true };
}
/** Latest report per customer, one row per product, with days of cover. */
export async function stockView(s: Session) {
  const p: any[] = []; const scope = can(s, 'credit.manage') ? '' : teamScope(s, p);
  return q<any>(
    `select c.name as customer, c.code as customer_code, c.town, pr.name as product, pr.code as product_code, i.stock, i.sold_30d, i.near_expiry, r.day, u.name as person,
            case when i.sold_30d > 0 then round(i.stock::numeric / i.sold_30d * 30)::int end as cover_days
       from stock_reports r join stock_report_items i on i.report_id=r.id join customers c on c.id=r.customer_id join products pr on pr.id=i.product_id join users u on u.id=r.user_id
      where r.day = (select max(day) from stock_reports x where x.customer_id=r.customer_id)${scope}
      order by c.name, pr.name limit 3000`, p);
}
