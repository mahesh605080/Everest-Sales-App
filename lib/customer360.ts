import { q } from './db';
import { HttpError } from './auth';
import { listRows } from './crud';
import { ENT } from './entities';
import { creditSnapshot } from './sales';
import { Session } from './perm';

/** One customer, everything: who looks after them, credit, and the latest activity of every kind. */
export async function customer360(s: Session, id: number) {
  const c = Number.isInteger(id) ? (await listRows(ENT.customers, s, { id })).rows[0] : null;
  if (!c) throw new HttpError(404, 'This customer is not in your territory.');
  const [credit, visits, booklets, orders, collections, claims, stock, history, totals] = await Promise.all([
    creditSnapshot(id),
    q(`select v.day, v.in_at, v.out_at, v.out_of_fence, v.distance_m, v.purpose, v.person_met, v.remarks, u.name as person from visits v join users u on u.id=v.user_id where v.customer_id=$1 order by v.in_at desc limit 15`, [id]),
    q(`select b.id, b.no, b.order_date, b.due_date, b.status, b.max_variance, u.name as person from booklets b join users u on u.id=b.user_id where b.customer_id=$1 order by b.created_at desc limit 10`, [id]),
    q(`select o.id, o.no, o.order_date, o.value, o.status, o.over_limit, o.invoice_no, u.name as person from sales_orders o join users u on u.id=o.user_id where o.customer_id=$1 order by o.created_at desc limit 15`, [id]),
    q(`select k.day, k.mode, k.amount, k.ref_no, k.status, u.name as person from collections k join users u on u.id=k.user_id where k.customer_id=$1 order by k.created_at desc limit 10`, [id]),
    q(`select k.day, k.type, k.amount, k.status, p.name as product from claims k left join products p on p.id=k.product_id where k.customer_id=$1 order by k.created_at desc limit 10`, [id]),
    q(`select pr.name as product, i.stock, i.sold_30d, i.near_expiry, r.day from stock_reports r join stock_report_items i on i.report_id=r.id join products pr on pr.id=i.product_id
        where r.customer_id=$1 and r.day=(select max(day) from stock_reports x where x.customer_id=$1) order by pr.name`, [id]),
    q(`select u.name as person, ca.from_date, ca.to_date from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=$1 order by ca.from_date desc, ca.id desc limit 10`, [id]),
    q(`select (select count(*)::int from visits where customer_id=$1 and day > current_date - 90) as visits_90d, (select max(day) from visits where customer_id=$1) as last_visit,
              (select coalesce(sum(value),0) from sales_orders where customer_id=$1 and status in ('Approved','Dispatched') and order_date > current_date - 365) as sales_12m,
              (select coalesce(sum(amount),0) from collections where customer_id=$1 and status='Verified' and day > current_date - 365) as collected_12m`, [id]),
  ]);
  return { customer: c, credit, visits, booklets, orders, collections, claims, stock, history, totals: totals[0] };
}
