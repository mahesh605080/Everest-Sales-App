import ExcelJS from 'exceljs';
import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { listRows } from './crud';
import { ENT } from './entities';
import { teamScope, TODAY } from './field';
import { Session } from './perm';
import { readGrid } from './xl';

const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const MONTH = 30.44;

/** Accepts 2027-03-31, 2027-03, 03/2027 and 3-2027; a month alone means the last day of that month. */
export function parseExpiry(raw: any): string | null {
  const v = String(raw ?? '').trim(); let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; return isNaN(Date.parse(d)) ? null : d; }
  let y = 0, mo = 0;
  if ((m = v.match(/^(\d{4})[-/](\d{1,2})$/))) { y = +m[1]; mo = +m[2]; }
  else if ((m = v.match(/^(\d{1,2})[-/](\d{4})$/))) { y = +m[2]; mo = +m[1]; }
  if (!y || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
}

/* ---------------- stock upload ---------------- */
export async function importStock(s: Session, file: File, asOf: string, mode: string, ip: string | null) {
  if (mode !== 'full' && mode !== 'partial') throw new HttpError(422, 'Say whether this file lists the whole stock, or only some batches.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || isNaN(Date.parse(asOf)) || Date.parse(asOf) > Date.now() + 864e5) throw new HttpError(422, 'Choose the as-of date of the stock figures (not in the future).');
  const grid = await readGrid(file);
  if (grid.length < 2) throw new HttpError(422, 'The file has a header row but no data rows.');
  const head = grid[0].map((h: any) => String(h).trim().toLowerCase()), find = (...n: string[]) => head.findIndex((h: string) => n.includes(h));
  const ix = { code: find('product code', 'code'), batch: find('batch', 'batch no', 'batch number'), exp: find('expiry', 'expiry date', 'exp'), qty: find('quantity (boxes)', 'quantity', 'boxes', 'qty'), loc: find('location', 'godown', 'warehouse') };
  if (ix.code < 0 || ix.batch < 0 || ix.exp < 0 || ix.qty < 0) throw new HttpError(422, 'Columns needed: Product code, Batch, Expiry, Quantity (boxes). Location is optional. Download the template.');
  const prods = new Map((await q<any>('select id, code from products')).map(p => [String(p.code).toUpperCase(), p.id]));
  const good: any[] = [], errors: { row: number; message: string }[] = [], seen = new Set<string>();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i], code = String(r[ix.code] ?? '').trim().toUpperCase(), batch = String(r[ix.batch] ?? '').trim().toUpperCase(), exp = parseExpiry(r[ix.exp]);
    const qty = Number(String(r[ix.qty] ?? '').replace(/,/g, '')), loc = (ix.loc >= 0 ? String(r[ix.loc] ?? '').trim() : '') || 'Main', key = `${code}|${batch}|${loc}`;
    if (!code && !batch) continue;
    if (!prods.has(code)) errors.push({ row: i + 1, message: `No product has the code "${code}".` });
    else if (!batch) errors.push({ row: i + 1, message: 'Batch is empty.' });
    else if (!exp) errors.push({ row: i + 1, message: `Expiry "${r[ix.exp]}" is not a date. Use 2027-03-31 or 03/2027.` });
    else if (!Number.isInteger(qty) || qty < 0) errors.push({ row: i + 1, message: 'Quantity must be whole boxes, zero or more.' });
    else if (seen.has(key)) errors.push({ row: i + 1, message: `Batch ${batch} of ${code} appears twice for ${loc}.` });
    else { seen.add(key); good.push([prods.get(code), batch, exp, qty, loc]); }
  }
  const up = (await q<any>('insert into stock_uploads(as_of,file_name,mode,rows_ok,rows_failed,uploaded_by) values($1,$2,$3,$4,$5,$6) returning id', [asOf, file.name.slice(0, 200), mode, good.length, errors.length, s.id]))[0].id;
  for (const g of good) await q(
    `insert into stock_batches(product_id,batch_no,expiry_date,qty_boxes,location,as_of,upload_id) values($1,$2,$3,$4,$5,$6,$7)
     on conflict(product_id,batch_no,location) do update set expiry_date=excluded.expiry_date, qty_boxes=excluded.qty_boxes, as_of=excluded.as_of, upload_id=excluded.upload_id, updated_at=now()`, [...g, asOf, up]);
  // A clean full file is the whole stock: any batch that is not in it has been sold out.
  let zeroed = 0;
  if (mode === 'full' && !errors.length) zeroed = (await q('update stock_batches set qty_boxes=0, as_of=$1, upload_id=$2, updated_at=now() where upload_id <> $2 and qty_boxes > 0 returning id', [asOf, up])).length;
  await audit(s, 'stock-upload', 'stock_batches', up, null, { as_of: asOf, file: file.name, mode, updated: good.length, skipped: errors.length, set_to_zero: zeroed }, ip);
  return { updated: good.length, failed: errors.length, zeroed, held: mode === 'full' && errors.length > 0, errors: errors.slice(0, 200) };
}
export async function stockTemplate() {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Stock');
  ws.columns = ['Product code', 'Batch', 'Expiry', 'Quantity (boxes)', 'Location'].map(h => ({ header: h, width: 20 })); ws.getRow(1).font = { bold: true };
  for (const b of await q<any>(`select p.code, b.batch_no, b.expiry_date, b.qty_boxes, b.location from stock_batches b join products p on p.id=b.product_id where b.qty_boxes > 0 order by p.code, b.expiry_date`)) ws.addRow([b.code, b.batch_no, b.expiry_date, b.qty_boxes, b.location]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const uploads = () => q(`select u.id,u.as_of,u.file_name,u.mode,u.rows_ok,u.rows_failed,u.at,x.name as by from stock_uploads u left join users x on x.id=u.uploaded_by order by u.at desc limit 15`);

/* ---------------- offers ---------------- */
export const offerSlabs = () => q<any>('select * from expiry_offers where active order by months_from');
export async function saveSlabs(s: Session, rows: any[], ip: string | null) {
  if (!Array.isArray(rows) || rows.length > 12) throw new HttpError(422, 'Give up to 12 slabs.');
  const clean = rows.map(r => ({ from: Number(r.months_from), to: Number(r.months_to), disc: Number(r.discount_pct) || 0, buy: Number(r.bonus_buy) || 0, free: Number(r.bonus_free) || 0 })).sort((a, b) => a.from - b.from);
  for (const [i, r] of clean.entries()) {
    if (!(r.from >= 0) || !(r.to > r.from) || r.to > 36) throw new HttpError(422, `Slab ${i + 1}: "to" must be more than "from", and at most 36 months.`);
    if (r.disc < 0 || r.disc > 90) throw new HttpError(422, `Slab ${i + 1}: discount must be between 0 and 90%.`);
    if (!Number.isInteger(r.buy) || !Number.isInteger(r.free) || r.buy < 0 || r.free < 0 || (r.free > 0 && r.buy <= 0)) throw new HttpError(422, `Slab ${i + 1}: bonus needs a buy and a free quantity, for example 5 + 1.`);
    if (r.disc === 0 && r.free === 0) throw new HttpError(422, `Slab ${i + 1} gives neither a discount nor a bonus.`);
    if (i && r.from < clean[i - 1].to) throw new HttpError(422, `Slab ${i + 1} overlaps the one before it.`);
  }
  const before = await offerSlabs();
  await q('update expiry_offers set active=false where active');
  for (const r of clean) await q('insert into expiry_offers(months_from,months_to,discount_pct,bonus_buy,bonus_free) values($1,$2,$3,$4,$5)', [r.from, r.to, r.disc, r.buy, r.free]);
  await audit(s, 'update', 'expiry_offers', null, { slabs: before.map((b: any) => `${b.months_from}-${b.months_to}: ${b.discount_pct}% ${b.bonus_buy}+${b.bonus_free}`) }, { slabs: clean.map(b => `${b.from}-${b.to}: ${b.disc}% ${b.buy}+${b.free}`) }, ip);
  return { ok: true };
}
const offerFor = (slabs: any[], months: number, trade: number) => {
  const o = slabs.find(x => months >= x.months_from && months < x.months_to); if (!o) return null;
  const rate = trade * (1 - o.discount_pct / 100) * (o.bonus_free > 0 ? o.bonus_buy / (o.bonus_buy + o.bonus_free) : 1);
  return { id: o.id, discount_pct: o.discount_pct, bonus_buy: o.bonus_buy, bonus_free: o.bonus_free, rate: round(rate, 4), text: [o.discount_pct ? `${o.discount_pct}% off` : '', o.bonus_free ? `${o.bonus_buy}+${o.bonus_free}` : ''].filter(Boolean).join(' and ') };
};

/* ---------------- stock position ---------------- */
/** Every batch in stock with what is still free to sell: uploaded quantity minus what has been ordered against it since the upload. */
async function batches(productId?: number) {
  return q<any>(
    `select b.id, b.product_id, b.batch_no, b.expiry_date, b.location, b.as_of, b.qty_boxes, p.code, p.name as product, p.pack_size, p.units_per_box, p.trade_rate,
            round(((b.expiry_date - ${TODAY})::numeric / ${MONTH}), 1) as months_left,
            greatest(b.qty_boxes - coalesce((select sum(i.qty) from sales_order_items i join sales_orders o on o.id=i.order_id
                                             where i.batch_id=b.id and o.created_at > b.updated_at and o.status not in ('Rejected','Withdrawn')),0), 0)::int as free_boxes
       from stock_batches b join products p on p.id=b.product_id
      where b.qty_boxes > 0 ${productId ? 'and b.product_id=$1' : ''} order by b.expiry_date, b.id`, productId ? [productId] : []);
}
/** Boxes per month the company has been selling, per product, from approved orders of the last 90 days. */
async function runRates() {
  return new Map((await q<any>(`select i.product_id, sum(i.qty)::numeric / 3 as per_month from sales_order_items i join sales_orders o on o.id=i.order_id
                                 where o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 90 group by i.product_id`)).map(r => [r.product_id as number, Number(r.per_month)]));
}

/**
 * The expiry picture. For each product the batches are walked in expiry order (FEFO): at the current monthly sale,
 * how much of each batch can be sold before it reaches the minimum shelf life? What is left over is "at risk".
 */
export async function expiryPosition() {
  const [rows, rates, slabs, minShelf, near] = [await batches(), await runRates(), await offerSlabs(), await setting('min_shelf_life_months', 2), await setting('near_expiry_months', 6)];
  const sold = new Map<number, number>();
  for (const b of rows) {
    const rate = rates.get(b.product_id) || 0, usable = Math.max(0, b.months_left - minShelf), already = sold.get(b.product_id) || 0;
    const canSell = Math.max(0, rate * usable - already), sells = Math.min(b.free_boxes, Math.floor(canSell));
    sold.set(b.product_id, already + sells);
    b.run_rate = round(rate, 1); b.at_risk = b.months_left <= 0 ? b.free_boxes : b.free_boxes - sells;
    b.value = round(b.free_boxes * b.units_per_box * b.trade_rate); b.risk_value = round(b.at_risk * b.units_per_box * b.trade_rate);
    b.expired = b.months_left <= 0; b.unsellable = !b.expired && b.months_left < minShelf;
    b.offer = b.expired || b.unsellable ? null : offerFor(slabs, b.months_left, b.trade_rate);
  }
  const bucket = (lo: number, hi: number) => { const x = rows.filter(b => b.months_left > lo && b.months_left <= hi); return { boxes: x.reduce((a, b) => a + b.free_boxes, 0), value: x.reduce((a, b) => a + b.value, 0), batches: x.length }; };
  const exp = rows.filter(b => b.expired);
  return { rows, min_shelf: minShelf, near_months: near, as_of: rows.reduce((a: string | null, b) => (!a || b.as_of > a ? b.as_of : a), null),
    ladder: [{ label: 'Expired', ...{ boxes: exp.reduce((a, b) => a + b.free_boxes, 0), value: exp.reduce((a, b) => a + b.value, 0), batches: exp.length }, k: 'crit' },
      { label: '0 to 3 months', ...bucket(0, 3), k: 'crit' }, { label: '3 to 6 months', ...bucket(3, 6), k: 'warn' }, { label: '6 to 9 months', ...bucket(6, 9), k: 'info' },
      { label: '9 to 12 months', ...bucket(9, 12), k: '' }, { label: 'Over 12 months', ...bucket(12, 999), k: 'good' }],
    at_risk_value: rows.reduce((a, b) => a + b.risk_value, 0), at_risk_boxes: rows.reduce((a, b) => a + b.at_risk, 0), total_value: rows.reduce((a, b) => a + b.value, 0) };
}

export async function batchOffer(id: number) {
  const pos = await expiryPosition(), b = pos.rows.find(x => x.id === id);
  if (!b) throw new HttpError(404, 'This batch is no longer in stock.');
  return b;
}

/** Customers who can use a batch before it expires: their monthly offtake of the product times the months that are left. */
export async function matchBuyers(s: Session, batchId: number) {
  const b = await batchOffer(batchId);
  if (b.expired || b.unsellable) return { batch: b, buyers: [] };
  const p: any[] = [b.product_id];
  const scope = `exists(select 1 from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=c.id and ca.to_date is null${teamScope(s, p)})`;
  const rows = await q<any>(
    `select c.id, c.name, c.type, c.town,
            coalesce((select sum(i.qty)::numeric / 6 from sales_order_items i join sales_orders o on o.id=i.order_id where o.customer_id=c.id and i.product_id=$1 and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 180),0) as bought_per_month,
            (select x.sold_30d from stock_report_items x join stock_reports r on r.id=x.report_id where r.customer_id=c.id and x.product_id=$1 order by r.day desc limit 1) as sold_30d,
            (select x.stock from stock_report_items x join stock_reports r on r.id=x.report_id where r.customer_id=c.id and x.product_id=$1 order by r.day desc limit 1) as stock,
            (select name from users u2 join customer_assignments ca2 on ca2.user_id=u2.id where ca2.customer_id=c.id and ca2.to_date is null limit 1) as person
       from customers c where c.active and ${scope}`, p);
  // One month is kept back for delivery and for the customer to actually use the last box.
  const usable = Math.max(0, b.months_left - 1);
  const buyers = rows.map(c => {
    const monthly = Math.max(Number(c.bought_per_month) || 0, Number(c.sold_30d) || 0);
    const can = Math.max(0, Math.floor(monthly * usable - (Number(c.stock) || 0)));
    return { ...c, monthly: round(monthly, 1), can_take: Math.min(can, b.free_boxes) };
  }).filter(c => c.can_take > 0).sort((a, b2) => b2.can_take - a.can_take).slice(0, 50);
  return { batch: b, usable_months: round(usable, 1), buyers };
}

/** Near-expiry batches that the viewer's own customers could take, best first. For the selling list. */
export async function expiryOpportunities(s: Session) {
  const pos = await expiryPosition(), out: any[] = [];
  for (const b of pos.rows.filter(x => x.offer && x.free_boxes > 0).slice(0, 12)) {
    const m = await matchBuyers(s, b.id);
    for (const c of m.buyers.slice(0, 3)) out.push({ batch_id: b.id, batch_no: b.batch_no, product: b.product, expiry_date: b.expiry_date, months_left: b.months_left, offer: b.offer.text, rate: b.offer.rate, trade_rate: b.trade_rate,
      customer_id: c.id, customer: c.name, can_take: c.can_take, value: round(c.can_take * b.units_per_box * b.offer.rate) });
  }
  return out.sort((a, b) => a.months_left - b.months_left || b.value - a.value).slice(0, 40);
}

/** Which batches to send for an ordinary order line: earliest expiry first, skipping stock that is too short-dated. */
export async function fefoPlan(productId: number, qty: number, minMonths: number, rows?: any[]) {
  const list = (rows || await batches(productId)).filter(b => b.product_id === productId && b.months_left >= minMonths && b.free_boxes > 0);
  const plan: { batch_no: string; expiry_date: string; qty: number }[] = []; let left = qty;
  for (const b of list) { if (left <= 0) break; const take = Math.min(left, b.free_boxes); plan.push({ batch_no: b.batch_no, expiry_date: b.expiry_date, qty: take }); left -= take; }
  return { plan, short: left };
}
export async function fefoForOrder(items: any[]) {
  const all = await batches(), minShelf = await setting('min_shelf_life_months', 2);
  for (const i of items) {
    if (i.batch_no) { i.fefo = null; continue; }
    const f = await fefoPlan(i.product_id, i.qty, minShelf, all);
    i.fefo = f.plan.length ? f : null;
  }
  return items;
}

/** A returns claim for stock that was sold as a non-returnable near-expiry lot is not allowed. */
export async function nonReturnableSale(customerId: number, batchNo: string) {
  return q1<any>(`select o.no from sales_order_items i join sales_orders o on o.id=i.order_id where o.customer_id=$1 and i.non_returnable and upper(i.batch_no)=upper($2) and o.status in ('Approved','Dispatched') limit 1`, [customerId, batchNo.trim()]);
}

export async function customerFor(s: Session, id: number) {
  const c = Number.isInteger(id) ? (await listRows(ENT.customers, s, { id })).rows[0] : null;
  if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.');
  return c;
}
