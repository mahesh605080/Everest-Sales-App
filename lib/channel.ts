import { q, q1 } from './db';
import { customerFor } from './inventory';
import { teamScope, TODAY } from './field';
import { Session } from './perm';

const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Latest stock report line per customer and product (not older than 45 days), with what has been ordered since. */
const LATEST = `
  select r.customer_id, i.product_id, i.stock, i.sold_30d, i.near_expiry, r.day,
         coalesce((select sum(oi.qty + oi.free_qty) from sales_order_items oi join sales_orders o on o.id=oi.order_id
                    where o.customer_id=r.customer_id and oi.product_id=i.product_id and o.order_date >= r.day and o.status in ('Pending','Approved','Dispatched')),0)::int as coming,
         coalesce((select sum(oi.qty + oi.free_qty) from sales_order_items oi join sales_orders o on o.id=oi.order_id
                    where o.customer_id=r.customer_id and oi.product_id=i.product_id and o.order_date > ${TODAY} - 90 and o.status in ('Approved','Dispatched')),0)::numeric / 3 as bought_pm
    from stock_reports r join stock_report_items i on i.report_id=r.id
   where r.day = (select max(day) from stock_reports x where x.customer_id=r.customer_id) and r.day > ${TODAY} - 45`;

/**
 * What this customer should order today. From its last stock report: fill each product up to the target days of sale,
 * less what it holds and what is already on order. Without a stock report: its usual monthly quantity of products it has not ordered for 30 days.
 */
export async function suggestOrder(s: Session, customerId: number) {
  const c = await customerFor(s, customerId), target = await setting('target_cover_days', 45), maxCover = await setting('max_cover_months', 3);
  const rows = await q<any>(`select l.*, p.name as product, p.pack_size from (${LATEST}) l join products p on p.id=l.product_id and p.active where l.customer_id=$1 order by p.name`, [c.id]);
  const stock = Object.fromEntries(rows.map(r => [r.product_id, { stock: r.stock, sold_30d: r.sold_30d, coming: r.coming }]));
  if (rows.length) {
    const items = rows.map(r => ({ product_id: r.product_id, product: r.product, qty: Math.ceil(r.sold_30d * target / 30 - r.stock - r.coming),
      why: `sells ${r.sold_30d} a month, holds ${r.stock}${r.coming ? `, ${r.coming} on order` : ''}` })).filter(i => i.qty > 0);
    return { basis: 'stock', day: rows[0].day, target_days: target, max_cover_months: maxCover, stock, items };
  }
  const hist = await q<any>(
    `select i.product_id, p.name as product, ceil(sum(i.qty)::numeric / 6)::int as qty, max(o.order_date) as last
       from sales_order_items i join sales_orders o on o.id=i.order_id join products p on p.id=i.product_id and p.active
      where o.customer_id=$1 and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 180 and i.batch_id is null
      group by i.product_id, p.name having max(o.order_date) < ${TODAY} - 30 order by p.name`, [c.id]);
  return { basis: hist.length ? 'history' : 'none', day: null, target_days: target, max_cover_months: maxCover, stock,
    items: hist.map(h => ({ product_id: h.product_id, product: h.product, qty: h.qty, why: `usual monthly quantity, last ordered ${h.last}` })) };
}

const mine = (s: Session, p: any[]) => `exists(select 1 from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=c.id and ca.to_date is null${teamScope(s, p)})`;

/** Bought from the company against sold to the market, per distributor and product. Shows stock piling up before it becomes an expiry return. */
export async function channelHealth(s: Session) {
  const maxCover = await setting('max_cover_months', 3), low = await setting('reorder_cover_days', 15), p: any[] = [];
  const rows = await q<any>(
    `select c.id as customer_id, c.name as customer, c.town, p.id as product_id, p.name as product, p.code as product_code, p.units_per_box, p.trade_rate, l.stock, l.sold_30d, l.near_expiry, l.coming, l.bought_pm, l.day
       from (${LATEST}) l join customers c on c.id=l.customer_id and c.active join products p on p.id=l.product_id where ${mine(s, p)} order by c.name, p.name limit 3000`, p);
  return { max_cover_months: maxCover, low_days: low, rows: rows.map(r => {
    const bought = Number(r.bought_pm), cover = r.sold_30d > 0 ? r.stock / r.sold_30d : null;
    const excess = r.sold_30d > 0 ? Math.max(0, Math.floor(r.stock - r.sold_30d * maxCover)) : r.stock;
    const status = r.sold_30d === 0 ? (r.stock > 0 ? 'Not selling' : 'Healthy') : cover! > maxCover ? (bought > r.sold_30d * 1.2 ? 'Piling up' : 'Overstocked') : cover! * 30 < low ? 'Running low' : bought > r.sold_30d * 1.5 && cover! > maxCover / 2 ? 'Piling up' : 'Healthy';
    return { ...r, bought_pm: round(bought), cover_months: cover == null ? null : round(cover), excess, excess_value: Math.round(excess * r.units_per_box * r.trade_rate), status };
  }) };
}

/**
 * Stock to move from a distributor who cannot sell it in time to one who is running short of the same product.
 * It saves an expiry return at one end and a lost sale at the other, without making anything new.
 */
export async function transfers(s: Session) {
  const maxCover = await setting('max_cover_months', 3), low = await setting('reorder_cover_days', 15), target = await setting('target_cover_days', 45), p: any[] = [];
  const rows = await q<any>(
    `select c.id as customer_id, c.name as customer, c.town, c.area_id, a.region_id, p.id as product_id, p.name as product, p.units_per_box, p.trade_rate, l.stock, l.sold_30d, l.near_expiry, l.coming
       from (${LATEST}) l join customers c on c.id=l.customer_id and c.active and c.type='Distributor' left join areas a on a.id=c.area_id join products p on p.id=l.product_id where ${mine(s, p)}`, p);
  const give = rows.map(r => ({ ...r, spare: Math.max(r.sold_30d > 0 ? Math.floor(r.stock - r.sold_30d * maxCover) : r.stock, Math.min(r.near_expiry, r.stock)),
    reason: r.sold_30d === 0 ? 'is not selling it' : r.stock > r.sold_30d * maxCover ? `holds ${round(r.stock / r.sold_30d)} months of sale` : `has ${r.near_expiry} boxes near expiry` })).filter(r => r.spare > 0);
  const take = rows.filter(r => r.sold_30d > 0 && r.stock / r.sold_30d * 30 < low).map(r => ({ ...r, need: Math.ceil(r.sold_30d * target / 30 - r.stock - r.coming) })).filter(r => r.need > 0);
  const out: any[] = [];
  for (const t of take.sort((a, b) => b.need - a.need)) {
    // nearest first: same area, then same region, then anyone
    const from = give.filter(g => g.product_id === t.product_id && g.customer_id !== t.customer_id && g.spare > 0)
      .sort((a, b) => Number(b.area_id === t.area_id) - Number(a.area_id === t.area_id) || Number(b.region_id === t.region_id) - Number(a.region_id === t.region_id) || b.spare - a.spare);
    for (const g of from) {
      if (t.need <= 0) break;
      const boxes = Math.min(g.spare, t.need); g.spare -= boxes; t.need -= boxes;
      out.push({ product_id: t.product_id, product: t.product, boxes, value: Math.round(boxes * t.units_per_box * t.trade_rate),
        from_id: g.customer_id, from: g.customer, from_town: g.town, reason: g.reason, to_id: t.customer_id, to: t.customer, to_town: t.town,
        to_cover_days: Math.round(t.stock / t.sold_30d * 30), near: g.area_id === t.area_id ? 'same area' : g.region_id === t.region_id ? 'same region' : 'other region' });
    }
  }
  return { rows: out.sort((a, b) => b.value - a.value).slice(0, 200) };
}
