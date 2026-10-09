import { q, q1 } from './db';
import { HttpError } from './auth';
import { teamScope, TODAY } from './field';
import { Session } from './perm';
import { expiryPosition, nonReturnableSale } from './inventory';

const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const money = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-IN');
export const EXPIRY_TYPES = ['Expired stock', 'Near expiry'];
export type Flag = { k: string; text: string };

/** Purchases and expiry returns of one customer in the last 12 months, and what the yearly cap still allows. */
export async function returnAllowance(customerId: number) {
  const cap = await setting('return_cap_pct', 2);
  const r = (await q1<any>(
    `select coalesce((select sum(o.value) from sales_orders o where o.customer_id=$1 and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365),0) as bought,
            coalesce((select sum(c.amount) from claims c where c.customer_id=$1 and c.type = any($2) and c.status not in ('Rejected','Withdrawn') and c.day > ${TODAY} - 365),0) as returned`, [customerId, EXPIRY_TYPES]))!;
  const bought = Number(r.bought), returned = Number(r.returned), allowed = round(bought * cap / 100);
  return { cap_pct: cap, bought, returned, allowed, left: round(Math.max(0, allowed - returned)) };
}

/**
 * The returns policy. Refuses a claim that is plainly outside it; anything doubtful is recorded as a flag
 * that the approver sees and must answer in the remarks.
 */
export async function checkClaim(v: any): Promise<Flag[]> {
  const flags: Flag[] = [], today = (await q1<any>(`select ${TODAY}::text d`))!.d as string;
  const monthsFromToday = (d: string) => (Date.parse(d) - Date.parse(today)) / 864e5 / 30.44;
  const prod = v.product_id ? await q1<any>('select name, units_per_box, trade_rate from products where id=$1', [v.product_id]) : null;
  if (prod && v.qty && v.amount > v.qty * prod.units_per_box * prod.trade_rate * 1.001)
    throw new HttpError(422, `${v.qty} boxes of ${prod.name} are worth ${money(v.qty * prod.units_per_box * prod.trade_rate)} at trade rate. The claim cannot be more than that.`);

  if (EXPIRY_TYPES.includes(v.type)) {
    if (!v.product_id || !v.qty || !v.batch_no || !v.expiry_date) throw new HttpError(422, 'An expiry claim needs the product, boxes, batch number and expiry date printed on the pack.');
    const sale = await nonReturnableSale(v.customer_id, v.batch_no);
    if (sale) throw new HttpError(422, `Batch ${v.batch_no} was sold to this customer on ${sale.no} as a non-returnable near-expiry lot, so an expiry claim cannot be raised for it.`);
    const before = await setting('return_before_expiry_months', 3), after = await setting('return_after_expiry_months', 6), m = monthsFromToday(v.expiry_date);
    if (m > before) throw new HttpError(422, `This stock expires in ${m.toFixed(1)} months. A return can be claimed only from ${before} months before expiry. It can still be sold: ask your manager to move it to a customer who needs it.`);
    if (m < -after) throw new HttpError(422, `This stock expired ${(-m).toFixed(1)} months ago. Expired stock must be claimed within ${after} months of expiry.`);
    if (v.type === 'Expired stock' && m > 0) throw new HttpError(422, 'This stock has not expired yet. Choose "Near expiry".');

    // Did the company make this batch, and did it go to this customer?
    const known = await q1<any>('select expiry_date from stock_batches where product_id=$1 and upper(batch_no)=upper($2) limit 1', [v.product_id, v.batch_no]);
    if (known && known.expiry_date !== v.expiry_date) flags.push({ k: 'expiry_mismatch', text: `Company record shows batch ${v.batch_no} expiring on ${known.expiry_date}, the claim says ${v.expiry_date}.` });
    const sent = await q1<any>(`select o.no from sales_order_items i join sales_orders o on o.id=i.order_id where o.customer_id=$1 and i.product_id=$2 and o.status='Dispatched' and upper(i.batch_no) like '%'||upper($3)||'%' limit 1`, [v.customer_id, v.product_id, v.batch_no]);
    if (!sent) {
      const any = await q1<any>(`select 1 from sales_order_items i join sales_orders o on o.id=i.order_id where o.customer_id=$1 and i.product_id=$2 and o.status in ('Approved','Dispatched') limit 1`, [v.customer_id, v.product_id]);
      flags.push(any ? { k: 'batch_not_traced', text: `No dispatch of batch ${v.batch_no} to this customer is on record. Check the invoice before approving.` }
        : { k: 'never_bought', text: `This customer has no order for ${prod?.name ?? 'this product'} in the system. Check where the stock came from.` });
    }
    const a = await returnAllowance(v.customer_id);
    if (a.returned + v.amount > a.allowed) flags.push({ k: 'over_cap', text: `Over the yearly limit: expiry returns would reach ${money(a.returned + v.amount)} against ${money(a.allowed)} allowed (${a.cap_pct}% of ${money(a.bought)} bought in 12 months). Needs the General Manager.` });
  }
  if (v.type === 'Breakage') {
    const days = await setting('breakage_claim_days', 15);
    const recent = await q1<any>(`select 1 from sales_orders o where o.customer_id=$1 and o.status='Dispatched' and o.dispatched_at > now() - ($2::int * interval '1 day') limit 1`, [v.customer_id, Math.round(days)]);
    if (!recent) flags.push({ k: 'late_breakage', text: `No dispatch to this customer in the last ${days} days. Breakage should be claimed within ${days} days of delivery.` });
  }
  return flags;
}

/** What expiry is costing: stock expired in the godown, returns from the market, and what near-expiry selling recovered. */
export async function expiryLoss(s: Session) {
  const p: any[] = [EXPIRY_TYPES], scope = teamScope(s, p);
  const base = `from claims c join users u on u.id=c.user_id where c.type = any($1) and c.status not in ('Rejected','Withdrawn') and c.day > ${TODAY} - 365${scope}`;
  const tot = (await q1<any>(`select coalesce(sum(c.amount),0) total, coalesce(sum(c.amount) filter (where c.status='Submitted'),0) waiting, coalesce(sum(c.amount) filter (where c.status in ('Approved','Settled')),0) accepted, count(*)::int n ${base}`, p))!;
  const months = await q<any>(`select to_char(date_trunc('month', c.day), 'YYYY-MM') as month, sum(c.amount) as amount, count(*)::int n ${base} group by 1 order by 1`, p);
  const byCustomer = await q<any>(`select k.id, k.name as customer, sum(c.amount) as amount, count(*)::int n,
         coalesce((select sum(o.value) from sales_orders o where o.customer_id=k.id and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365),0) as bought
    from claims c join users u on u.id=c.user_id join customers k on k.id=c.customer_id where c.type = any($1) and c.status not in ('Rejected','Withdrawn') and c.day > ${TODAY} - 365${scope} group by k.id, k.name order by 3 desc limit 10`, p);
  const byProduct = await q<any>(`select pr.name as product, pr.code, sum(c.amount) as amount, coalesce(sum(c.qty),0)::int as boxes
    from claims c join users u on u.id=c.user_id join products pr on pr.id=c.product_id where c.type = any($1) and c.status not in ('Rejected','Withdrawn') and c.day > ${TODAY} - 365${scope} group by pr.name, pr.code order by 3 desc limit 10`, p);
  const p2: any[] = [], scope2 = teamScope(s, p2);
  const lots = (await q1<any>(`select coalesce(sum(i.value),0) as sold, coalesce(sum(i.qty * i.units_per_box * pr.trade_rate),0) as trade_value, coalesce(sum(i.qty),0)::int as boxes
    from sales_order_items i join sales_orders o on o.id=i.order_id join users u on u.id=o.user_id join products pr on pr.id=i.product_id
   where i.non_returnable and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365${scope2}`, p2))!;
  const sales = Number((await q1<any>(`select coalesce(sum(o.value),0) v from sales_orders o join users u on u.id=o.user_id where o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365${scope2}`, p2))!.v);
  const pos = await expiryPosition(), cap = await setting('return_cap_pct', 2);
  return {
    returns: { total: Number(tot.total), waiting: Number(tot.waiting), accepted: Number(tot.accepted), count: tot.n, pct_of_sales: sales > 0 ? round(Number(tot.total) / sales * 100, 2) : null, cap_pct: cap },
    months: months.map(m => ({ ...m, amount: Number(m.amount) })),
    byCustomer: byCustomer.map(c => ({ ...c, amount: Number(c.amount), pct: Number(c.bought) > 0 ? round(Number(c.amount) / Number(c.bought) * 100, 1) : null, over: Number(c.amount) > Number(c.bought) * cap / 100 })),
    byProduct: byProduct.map(x => ({ ...x, amount: Number(x.amount) })),
    lots: { sold: Number(lots.sold), trade_value: Number(lots.trade_value), given: round(Number(lots.trade_value) - Number(lots.sold)), boxes: lots.boxes },
    godown: { expired_value: pos.ladder[0].value, expired_boxes: pos.ladder[0].boxes, at_risk_value: pos.at_risk_value, at_risk_boxes: pos.at_risk_boxes },
  };
}
