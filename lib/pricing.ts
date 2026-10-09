import { q } from './db';
import { TODAY } from './field';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export type Price = { rate: number; source: 'trade' | 'type' | 'customer'; name?: string };

/** The rate each product sells at to this customer today: its own contract rate, else its customer type's price list, else the trade rate. */
export async function pricesFor(cust: { id: number; type: string }) {
  const rows = await q<any>(
    `select distinct on (r.product_id) r.product_id, r.rate, r.name, (r.customer_id is not null) as own
       from price_rules r where r.active and (r.customer_id=$1 or (r.customer_id is null and r.customer_type=$2))
        and (r.valid_from is null or r.valid_from <= ${TODAY}) and (r.valid_to is null or r.valid_to >= ${TODAY})
      order by r.product_id, (r.customer_id is not null) desc, r.valid_from desc nulls last, r.id desc`, [cust.id, cust.type]);
  return new Map<number, Price>(rows.map(r => [r.product_id as number, { rate: Number(r.rate), source: r.own ? 'customer' : 'type', name: r.name }]));
}

export const schemeText = (s: any) => [s.bonus_free > 0 ? `${s.bonus_buy}+${s.bonus_free}` : '', s.discount_pct > 0 ? `${Number(s.discount_pct)}% off` : ''].filter(Boolean).join(' and ');

/** Schemes running today that this customer can get. */
export async function schemesFor(cust: { id: number; type: string }) {
  return (await q<any>(
    `select s.id, s.code, s.name, s.product_id, s.min_qty, s.bonus_buy, s.bonus_free, s.discount_pct, s.valid_to
       from schemes s where s.active and (s.customer_type is null or s.customer_type=$1) and s.valid_from <= ${TODAY} and s.valid_to >= ${TODAY} order by s.product_id, s.min_qty`, [cust.type]))
    .map(s => ({ ...s, discount_pct: Number(s.discount_pct), text: schemeText(s) }));
}

/** What one scheme gives on a quantity. */
export function schemeGives(s: any, qty: number, unitsPerBox: number, rate: number) {
  if (qty < s.min_qty) return null;
  const free = s.bonus_free > 0 ? Math.floor(qty / s.bonus_buy) * s.bonus_free : 0, disc = s.discount_pct || 0;
  if (!free && !disc) return null;
  return { scheme: s, free, disc, worth: free * unitsPerBox * rate + qty * unitsPerBox * rate * disc / 100 };
}
/** The scheme that is worth the most to the customer on this line. Schemes never stack. */
export function bestScheme(schemes: any[], productId: number, qty: number, unitsPerBox: number, rate: number) {
  let best: ReturnType<typeof schemeGives> = null;
  for (const s of schemes) if (s.product_id === productId) { const g = schemeGives(s, qty, unitsPerBox, rate); if (g && (!best || g.worth > best.worth)) best = g; }
  return best;
}

export async function pricingFor(cust: { id: number; type: string }) {
  const [prices, schemes] = [await pricesFor(cust), await schemesFor(cust)];
  return { rates: Object.fromEntries(prices), schemes };
}

/**
 * What each scheme sold and what it cost. Uplift compares boxes per day while the scheme ran with the same number of days just before it,
 * for the same product and customer type, so a scheme that only gave away margin shows up.
 */
export async function schemeResults() {
  const rows = await q<any>(
    `with s as (select s.*, p.name as product, p.code as product_code, p.units_per_box, p.trade_rate,
                       least(s.valid_to, ${TODAY}) as upto, greatest(least(s.valid_to, ${TODAY}) - s.valid_from + 1, 0) as days from schemes s join products p on p.id=s.product_id)
     select s.id, s.code, s.name, s.product, s.product_code, s.customer_type, s.min_qty, s.bonus_buy, s.bonus_free, s.discount_pct, s.valid_from, s.valid_to, s.active, s.days,
            (s.valid_from <= ${TODAY} and s.valid_to >= ${TODAY} and s.active) as running,
            coalesce(u.orders,0)::int as orders, coalesce(u.customers,0)::int as customers, coalesce(u.boxes,0)::int as boxes, coalesce(u.free_boxes,0)::int as free_boxes,
            coalesce(u.value,0) as value, coalesce(u.discount,0) as discount, coalesce(u.free_boxes,0) * s.units_per_box * s.trade_rate as free_value,
            coalesce(d.boxes,0)::int as during_boxes, coalesce(b.boxes,0)::int as before_boxes
       from s
       left join lateral (select count(distinct o.id) orders, count(distinct o.customer_id) customers, sum(i.qty) boxes, sum(i.free_qty) free_boxes, sum(i.value) value,
                                 sum(i.qty * i.units_per_box * (coalesce(i.list_rate, i.rate) - i.rate)) discount
                            from sales_order_items i join sales_orders o on o.id=i.order_id where i.scheme_id=s.id and o.status in ('Pending','Approved','Dispatched')) u on true
       left join lateral (select sum(i.qty) boxes from sales_order_items i join sales_orders o on o.id=i.order_id join customers c on c.id=o.customer_id
                           where i.product_id=s.product_id and (s.customer_type is null or c.type=s.customer_type) and o.status in ('Pending','Approved','Dispatched') and o.order_date between s.valid_from and s.upto) d on true
       left join lateral (select sum(i.qty) boxes from sales_order_items i join sales_orders o on o.id=i.order_id join customers c on c.id=o.customer_id
                           where i.product_id=s.product_id and (s.customer_type is null or c.type=s.customer_type) and o.status in ('Pending','Approved','Dispatched') and o.order_date >= s.valid_from - s.days and o.order_date < s.valid_from) b on true
      order by running desc, s.valid_from desc limit 200`);
  return rows.map(r => {
    const cost = Number(r.discount) + Number(r.free_value), value = Number(r.value);
    return { ...r, text: schemeText(r), value: round(value), cost: round(cost), cost_pct: value > 0 ? round(cost / value * 100, 1) : null,
      uplift_pct: r.days > 0 && r.before_boxes > 0 ? round((r.during_boxes - r.before_boxes) / r.before_boxes * 100, 0) : null };
  });
}
