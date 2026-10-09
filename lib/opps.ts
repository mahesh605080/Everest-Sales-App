import { q, q1 } from './db';
import { HttpError } from './auth';
import { listRows } from './crud';
import { ENT } from './entities';
import { teamScope, TODAY } from './field';
import { Session } from './perm';

const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);

/** Where the next sale is: approved rates not yet ordered, customers who stopped ordering, distributors running low. */
export async function opportunities(s: Session) {
  const noOrder = Math.max(1, Math.round(await setting('no_order_days', 30))), cover = Math.max(1, Math.round(await setting('reorder_cover_days', 15)));
  await q(`update booklets set status='Expired', level=null, updated_at=now() where status in ('Pending','Accepted') and due_date < ${TODAY}`);
  // "My customers" for a field user, the team's customers for a manager.
  const mine = (p: any[]) => `exists(select 1 from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=c.id and ca.to_date is null${teamScope(s, p)})`;

  const p1: any[] = [];
  const booklets = await q<any>(
    `select b.id, b.no, b.due_date, (b.due_date - ${TODAY}) as days_left, c.id as customer_id, c.name as customer, u.name as person,
            sum(greatest(x.balance,0))::int as boxes_left, sum(greatest(x.balance,0) * x.units_per_box * x.net_rate) as value_left
       from booklets b join customers c on c.id=b.customer_id join users u on u.id=b.user_id
       join lateral (select i.net_rate, pr.units_per_box,
                            i.qty - coalesce((select sum(oi.qty) from sales_order_items oi join sales_orders o on o.id=oi.order_id
                                               where o.booklet_id=b.id and oi.product_id=i.product_id and o.status not in ('Rejected','Withdrawn')),0) as balance
                       from booklet_items i join products pr on pr.id=i.product_id where i.booklet_id=b.id) x on true
      where b.status='Accepted' and ${mine(p1)}
      group by b.id, c.id, u.name having sum(greatest(x.balance,0)) > 0 order by b.due_date limit 100`, p1);

  const p2: any[] = [noOrder];
  const lapsed = await q<any>(
    `select c.id as customer_id, c.name as customer, c.type, c.town, lo.last_order, (${TODAY} - lo.last_order) as days_since, lo.orders_12m, lo.value_12m,
            (select name from users u2 join customer_assignments ca2 on ca2.user_id=u2.id where ca2.customer_id=c.id and ca2.to_date is null limit 1) as person
       from customers c
       left join lateral (select max(o.order_date) as last_order, count(*) filter (where o.order_date > ${TODAY} - 365)::int as orders_12m,
                                 coalesce(sum(o.value) filter (where o.order_date > ${TODAY} - 365),0) as value_12m
                            from sales_orders o where o.customer_id=c.id and o.status in ('Approved','Dispatched','Pending')) lo on true
      where c.active and c.type in ('Distributor','Hospital','Institution') and ${mine(p2)}
        and (lo.last_order is null or lo.last_order < ${TODAY} - $1::int)
      order by lo.value_12m desc nulls last, lo.last_order nulls last limit 100`, p2);

  const p3: any[] = [cover];
  const reorder = await q<any>(
    `select c.id as customer_id, c.name as customer, pr.id as product_id, pr.name as product, pr.pack_size, i.stock, i.sold_30d, r.day,
            round(i.stock::numeric / i.sold_30d * 30)::int as cover_days, greatest(i.sold_30d - i.stock, 1) as suggest_boxes
       from stock_reports r join stock_report_items i on i.report_id=r.id join customers c on c.id=r.customer_id join products pr on pr.id=i.product_id
      where r.day = (select max(day) from stock_reports x where x.customer_id=r.customer_id) and r.day > ${TODAY} - 45 and i.sold_30d > 0
        and i.stock::numeric / i.sold_30d * 30 < $1::int and c.active and ${mine(p3)}
        and not exists(select 1 from sales_orders o join sales_order_items oi on oi.order_id=o.id where o.customer_id=c.id and oi.product_id=pr.id and o.order_date >= r.day and o.status not in ('Rejected','Withdrawn'))
      order by cover_days, c.name limit 100`, p3);

  return { settings: { no_order_days: noOrder, reorder_cover_days: cover }, booklets, lapsed, reorder,
    totals: { booklet_value: booklets.reduce((a, b) => a + b.value_left, 0), lapsed: lapsed.length, reorder: reorder.length } };
}

/** The lines of the customer's most recent order, to start a repeat order from. */
export async function lastOrder(s: Session, customerId: number) {
  const c = Number.isInteger(customerId) ? (await listRows(ENT.customers, s, { id: customerId })).rows[0] : null;
  if (!c || !c.active) throw new HttpError(403, 'This customer is not in your territory.');
  const o = await q1<any>(`select id, no, order_date from sales_orders where customer_id=$1 and status in ('Approved','Dispatched','Pending') order by created_at desc limit 1`, [customerId]);
  if (!o) return { order: null, items: [] };
  return { order: o, items: await q<any>('select i.product_id, i.qty from sales_order_items i join products p on p.id=i.product_id where i.order_id=$1 and p.active order by i.id', [o.id]) };
}

/** Counts, values and waiting times along booklet -> order -> approval -> dispatch, for the viewer's territory. */
export async function pipeline(s: Session, from: string, to: string) {
  const p: any[] = [from, to]; const scope = teamScope(s, p);
  const bv = `(select coalesce(sum(i.qty * pr.units_per_box * i.net_rate),0) from booklet_items i join products pr on pr.id=i.product_id where i.booklet_id=b.id)`;
  return q1<any>(
    `select (select count(*)::int from booklets b join users u on u.id=b.user_id where b.status='Pending'${scope}) as bk_pending,
            (select coalesce(sum(${bv}),0) from booklets b join users u on u.id=b.user_id where b.status='Pending'${scope}) as bk_pending_value,
            (select count(*)::int from booklets b join users u on u.id=b.user_id where b.status='Accepted'${scope}) as bk_accepted,
            (select count(*)::int from sales_orders o join users u on u.id=o.user_id where o.status='Pending'${scope}) as so_pending,
            (select coalesce(sum(o.value),0) from sales_orders o join users u on u.id=o.user_id where o.status='Pending'${scope}) as so_pending_value,
            (select count(*)::int from sales_orders o join users u on u.id=o.user_id where o.status='Approved'${scope}) as so_approved,
            (select coalesce(sum(o.value),0) from sales_orders o join users u on u.id=o.user_id where o.status='Approved'${scope}) as so_approved_value,
            (select count(*)::int from sales_orders o join users u on u.id=o.user_id where o.status='Dispatched' and (o.dispatched_at at time zone 'Asia/Kathmandu')::date between $1::date and $2::date${scope}) as so_dispatched,
            (select coalesce(sum(o.value),0) from sales_orders o join users u on u.id=o.user_id where o.status='Dispatched' and (o.dispatched_at at time zone 'Asia/Kathmandu')::date between $1::date and $2::date${scope}) as so_dispatched_value,
            (select count(*)::int from sales_orders o join users u on u.id=o.user_id where o.status='Rejected' and o.order_date between $1::date and $2::date${scope}) as so_rejected,
            (select round(avg(extract(epoch from (o.decided_at - o.created_at))/3600)::numeric,1) from sales_orders o join users u on u.id=o.user_id where o.decided_at is not null and o.order_date between $1::date and $2::date${scope}) as hours_to_approve,
            (select round(avg(extract(epoch from (o.dispatched_at - o.decided_at))/3600)::numeric,1) from sales_orders o join users u on u.id=o.user_id where o.dispatched_at is not null and o.order_date between $1::date and $2::date${scope}) as hours_to_dispatch,
            (select round(avg(extract(epoch from (b.updated_at - b.created_at))/3600)::numeric,1) from booklets b join users u on u.id=b.user_id where b.status='Accepted' and b.order_date between $1::date and $2::date${scope}) as hours_to_accept`, p);
}
