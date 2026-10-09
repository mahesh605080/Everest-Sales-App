import { q, q1 } from './db';
import { HttpError } from './auth';
import { listRows } from './crud';
import { ENT } from './entities';
import { teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { expiryOpportunities } from './inventory';

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
    `select c.id as customer_id, c.name as customer, pr.id as product_id, pr.name as product, pr.pack_size, pr.units_per_box, pr.trade_rate, i.stock, i.sold_30d, r.day,
            round(i.stock::numeric / i.sold_30d * 30)::int as cover_days, greatest(i.sold_30d - i.stock, 1) as suggest_boxes
       from stock_reports r join stock_report_items i on i.report_id=r.id join customers c on c.id=r.customer_id join products pr on pr.id=i.product_id
      where r.day = (select max(day) from stock_reports x where x.customer_id=r.customer_id) and r.day > ${TODAY} - 45 and i.sold_30d > 0
        and i.stock::numeric / i.sold_30d * 30 < $1::int and c.active and ${mine(p3)}
        and not exists(select 1 from sales_orders o join sales_order_items oi on oi.order_id=o.id where o.customer_id=c.id and oi.product_id=pr.id and o.order_date >= r.day and o.status not in ('Rejected','Withdrawn'))
      order by cover_days, c.name limit 100`, p3);

  const expiry = can(s, 'inventory.view') ? await expiryOpportunities(s) : [];
  return { settings: { no_order_days: noOrder, reorder_cover_days: cover }, booklets, lapsed, reorder, expiry,
    totals: { booklet_value: booklets.reduce((a, b) => a + b.value_left, 0), lapsed: lapsed.length, reorder: reorder.length, expiry_value: expiry.reduce((a: number, e: any) => a + e.value, 0) } };
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

/* ---------------- customer classes (A/B/C) ---------------- */
/** A = the customers who make the first 80% of the last 12 months' sales, B = the next 15%, C = the rest. Company-wide, so a class means the same everywhere. */
export async function customerClasses() {
  const rows = await q<any>(
    `select c.id, coalesce(sum(o.value),0) as value from customers c left join sales_orders o on o.customer_id=c.id and o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365
      where c.active group by c.id order by 2 desc, c.id`);
  const total = rows.reduce((a, r) => a + Number(r.value), 0), map = new Map<number, { cls: 'A' | 'B' | 'C'; value: number }>(); let run = 0;
  for (const r of rows) { const v = Number(r.value), before = run; run += v; map.set(r.id, { cls: v > 0 && total > 0 && before < total * 0.8 ? 'A' : v > 0 && before < total * 0.95 ? 'B' : 'C', value: v }); }
  return { map, total };
}

/** Class summary for the viewer's customers, with visit discipline per class. */
export async function segments(s: Session) {
  const { map, total } = await customerClasses(), norm = { A: await setting('visit_days_a', 15), B: await setting('visit_days_b', 30), C: await setting('visit_days_c', 60) }, p: any[] = [];
  const rows = await q<any>(
    `select c.id, c.name, c.type, c.town, (select max(v.day) from visits v where v.customer_id=c.id) as last_visit,
            (${TODAY} - (select max(v.day) from visits v where v.customer_id=c.id)) as days_since,
            (select name from users u2 join customer_assignments ca2 on ca2.user_id=u2.id where ca2.customer_id=c.id and ca2.to_date is null limit 1) as person
       from customers c where c.active and exists(select 1 from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=c.id and ca.to_date is null${teamScope(s, p)})`, p);
  const list = rows.map(r => { const k = map.get(r.id) || { cls: 'C' as const, value: 0 }; return { ...r, cls: k.cls, value: k.value, norm_days: norm[k.cls], overdue: r.days_since == null || r.days_since > norm[k.cls] }; })
    .sort((a, b) => b.value - a.value);
  const sum = (['A', 'B', 'C'] as const).map(c => { const x = list.filter(r => r.cls === c); return { cls: c, customers: x.length, value: x.reduce((a, r) => a + r.value, 0), norm_days: norm[c], overdue: x.filter(r => r.overdue).length }; });
  return { summary: sum, company_total: total, customers: list };
}

/* ---------------- one ranked action list ---------------- */
const REASONS = ['Has enough stock', 'Price too high', 'Buying from a competitor', 'Payment problem', 'Customer not available', 'Other'];
export const ACTION_REASONS = REASONS;

/**
 * Everything worth doing today in one list, best first. Score = the rupees the action can bring, weighted by how soon the chance disappears.
 * Actions the field already answered stay hidden until their "hide until" date.
 */
export async function actions(s: Session) {
  const o = await opportunities(s), seg = await segments(s), out: any[] = [];
  const cls = new Map(seg.customers.map(c => [c.id, c.cls]));
  for (const e of o.expiry) out.push({ key: `lot:${e.customer_id}:${e.batch_id}`, kind: 'Near-expiry lot', customer_id: e.customer_id, customer: e.customer, value: e.value, weight: e.months_left <= 3 ? 3 : 2,
    text: `${e.product}, batch ${e.batch_no} (exp ${e.expiry_date}): ${e.offer}. Can use ${e.can_take} boxes in time.`, href: `/orders?customer=${e.customer_id}&batch=${e.batch_id}&qty=${e.can_take}`, cta: 'Create order' });
  for (const b of o.booklets) out.push({ key: `bk:${b.customer_id}:${b.id}`, kind: 'Approved rate', customer_id: b.customer_id, customer: b.customer, value: b.value_left, weight: b.days_left <= 2 ? 3 : b.days_left <= 5 ? 2 : 1.5,
    text: `Booklet ${b.no}: ${b.boxes_left} boxes still to order, ${b.days_left === 0 ? 'ends today' : b.days_left + ' days left'}.`, href: `/orders?customer=${b.customer_id}&booklet=${b.id}`, cta: 'Create order' });
  for (const r of o.reorder) out.push({ key: `ro:${r.customer_id}:${r.product_id}`, kind: 'Running low', customer_id: r.customer_id, customer: r.customer, value: r.suggest_boxes * r.units_per_box * r.trade_rate, weight: r.cover_days <= 5 ? 2.5 : 1.8,
    text: `${r.product}: ${r.cover_days} days of stock left. Suggest ${r.suggest_boxes} boxes.`, href: `/orders?customer=${r.customer_id}&product=${r.product_id}&qty=${r.suggest_boxes}`, cta: 'Create order' });
  for (const c of o.lapsed) if (c.last_order) out.push({ key: `lap:${c.customer_id}`, kind: 'Stopped ordering', customer_id: c.customer_id, customer: c.customer, value: Number(c.value_12m) / 12, weight: 1.2,
    text: `No order for ${c.days_since} days. Used to buy about Rs ${Math.round(Number(c.value_12m) / 12).toLocaleString('en-IN')} a month.`, href: `/orders?customer=${c.customer_id}&repeat=1`, cta: 'Repeat last order' });
  for (const c of seg.customers) if (c.overdue && c.cls !== 'C') out.push({ key: `visit:${c.id}`, kind: `Visit due · class ${c.cls}`, customer_id: c.id, customer: c.name, value: c.value / 12, weight: c.cls === 'A' ? 1 : 0.6,
    text: c.last_visit ? `Last visited ${c.days_since} days ago; class ${c.cls} should be seen every ${c.norm_days} days.` : `Never visited; class ${c.cls} should be seen every ${c.norm_days} days.`, href: `/customers/${c.id}`, cta: 'Open customer' });
  const hidden = new Set((await q<any>(`select distinct key from action_feedback where hide_until >= ${TODAY}`)).map(r => r.key));
  const list = out.filter(a => !hidden.has(a.key)).map(a => ({ ...a, cls: cls.get(a.customer_id) || 'C', value: Math.round(a.value), score: Math.round(a.value * a.weight) })).sort((a, b) => b.score - a.score);
  return { actions: list.slice(0, 60), total: list.length, value: list.reduce((a, x) => a + x.value, 0), reasons: REASONS };
}

export async function actionFeedback(s: Session, b: any) {
  const key = String(b.key || ''), m = key.match(/^(lot|bk|ro|lap|visit):(\d+)(?::\d+)?$/), outcome = String(b.outcome || '');
  if (!m) throw new HttpError(422, 'Unknown action.');
  if (!['done', 'later', 'no'].includes(outcome)) throw new HttpError(422, 'Choose what happened.');
  const reason = outcome === 'no' ? String(b.reason || '').trim().slice(0, 200) : null;
  if (outcome === 'no' && !reason) throw new HttpError(422, 'Say why the customer is not interested. It helps the manager fix the cause.');
  const c = (await listRows(ENT.customers, s, { id: Number(m[2]) })).rows[0];
  if (!c) throw new HttpError(403, 'This customer is not in your territory.');
  const days = outcome === 'done' ? 7 : outcome === 'later' ? 3 : 14;
  await q(`insert into action_feedback(key,user_id,customer_id,kind,outcome,reason,hide_until) values($1,$2,$3,$4,$5,$6,${TODAY} + $7::int)`, [key, s.id, c.id, m[1], outcome, reason, days]);
  return { ok: true, hidden_days: days };
}

/** Why customers said no, for the manager: the reasons of the last 30 days, and the latest answers. */
export async function feedbackSummary(s: Session) {
  const p: any[] = [], scope = teamScope(s, p);
  const base = `from action_feedback f join users u on u.id=f.user_id where f.at > now() - interval '30 days'${scope}`;
  return { reasons: await q<any>(`select f.reason, count(*)::int n ${base} and f.outcome='no' group by f.reason order by 2 desc limit 10`, p),
    counts: (await q1<any>(`select count(*) filter (where f.outcome='done')::int done, count(*) filter (where f.outcome='later')::int later, count(*) filter (where f.outcome='no')::int no ${base}`, p))!,
    latest: await q<any>(`select f.at, f.kind, f.outcome, f.reason, u.name as person, c.name as customer, c.id as customer_id ${base.replace('where', 'left join customers c on c.id=f.customer_id where')} and f.outcome='no' order by f.at desc limit 30`, p) };
}
