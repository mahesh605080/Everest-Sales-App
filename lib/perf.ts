import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { runAlerts, teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { pipeline } from './opps';

const NP = (col: string) => `(${col} at time zone 'Asia/Kathmandu')::date`;
const okMonth = (m: any) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);

export async function monthInfo(month?: string | null) {
  const today = (await q1<any>(`select ${TODAY}::text d`))!.d as string;
  const m = okMonth(month) ? month! : today.slice(0, 7);
  const days = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const from = `${m}-01`, to = `${m}-${String(days).padStart(2, '0')}`;
  const elapsed = m < today.slice(0, 7) ? days : m > today.slice(0, 7) ? 0 : +today.slice(8);
  return { month: m, from, to, days, elapsed, pace: elapsed / days, today, upto: m === today.slice(0, 7) ? today : to };
}

/** One row per field person with everything the scorecard, targets and incentive screens need. */
export async function people(s: Session, month?: string | null) {
  const mi = await monthInfo(month); const p: any[] = [mi.from, mi.to, mi.month, mi.upto]; const scope = teamScope(s, p);
  const norm = await setting('visits_per_day_norm', 4), i90 = await setting('incentive_pct_at_90', 0.2), i100 = await setting('incentive_pct_at_100', 0.4);
  const rows = await q<any>(
    `select u.id,u.code,u.name,r.name as role,r.key as role_key,a.name as area,g.name as region,
       coalesce((select amount from targets t where t.user_id=u.id and t.month=$3),0) as target,
       coalesce((select sum(o.value) from sales_orders o where o.user_id=u.id and o.status in ('Approved','Dispatched') and ${NP('o.decided_at')} between $1::date and $2::date),0) as sales,
       coalesce((select sum(k.amount) from collections k where k.user_id=u.id and k.status <> 'Rejected' and k.status <> 'Withdrawn' and k.day between $1::date and $2::date),0) as collection,
       coalesce((select sum(ob.b1+ob.b2+ob.b3) from outstanding_balances ob join customer_assignments ca on ca.customer_id=ob.customer_id and ca.to_date is null where ca.user_id=u.id),0) as overdue,
       (select count(distinct v.day)::int from visits v where v.user_id=u.id and v.day between $1::date and $2::date) as days_present,
       (select count(*)::int from visits v where v.user_id=u.id and v.day between $1::date and $2::date) as visits,
       (select count(*)::int from visits v where v.user_id=u.id and v.day between $1::date and $2::date and v.out_of_fence) as flagged,
       (select count(*)::int from tour_plan_items i join tour_plans tp on tp.id=i.plan_id where tp.user_id=u.id and tp.month=$3 and tp.status='Approved' and i.day <= $4::date) as planned,
       (select count(*)::int from tour_plan_items i join tour_plans tp on tp.id=i.plan_id where tp.user_id=u.id and tp.month=$3 and tp.status='Approved' and i.day <= $4::date
           and exists(select 1 from visits v where v.user_id=u.id and v.customer_id=i.customer_id and v.day=i.day)) as planned_done,
       (select count(*)::int from sales_orders o where o.user_id=u.id and o.order_date between $1::date and $2::date and o.status not in ('Rejected','Withdrawn')) as orders
     from users u join roles r on r.id=u.role_id left join areas a on a.id=u.area_id left join regions g on g.id=u.region_id
    where u.active and r.permissions ? 'field.use' and r.key <> 'admin'${scope} order by u.name`, p);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  for (const r of rows) {
    const sVis = r.planned > 0 ? clamp(r.planned_done / r.planned) : r.days_present > 0 ? clamp(r.visits / (r.days_present * norm)) : 0;
    const sSal = r.target > 0 && mi.pace > 0 ? clamp(r.sales / (r.target * mi.pace)) : 0;
    const sCol = r.overdue > 0 ? clamp(r.collection / r.overdue) : r.days_present > 0 ? 1 : 0;
    const sDis = r.visits > 0 ? 1 - r.flagged / r.visits : 0;
    r.parts = { visits: Math.round(sVis * 100), sales: Math.round(sSal * 100), collection: Math.round(sCol * 100), discipline: Math.round(sDis * 100) };
    r.score = Math.round(sVis * 30 + sSal * 35 + sCol * 20 + sDis * 15);
    r.ach = r.target > 0 ? r.sales / r.target * 100 : null;
    r.projected = r.target > 0 && mi.pace > 0 ? r.sales / mi.pace / r.target * 100 : null;
    const basis = mi.pace >= 1 ? r.ach : r.projected;
    r.incentive = basis == null ? 0 : basis >= 100 ? Math.round(r.target * i100 / 100) : basis >= 90 ? Math.round(r.target * i90 / 100) : 0;
  }
  return { info: mi, rows, weights: { visits: 30, sales: 35, collection: 20, discipline: 15 }, incentive: { at90: i90, at100: i100 } };
}

export async function overview(s: Session, month?: string | null) {
  await runAlerts();
  const { info, rows } = await people(s, month);
  const p: any[] = [info.from, info.to]; const scope = teamScope(s, p);
  const daily = await q<any>(`select ${NP('o.decided_at')}::text as day, sum(o.value) as value from sales_orders o join users u on u.id=o.user_id
                               where o.status in ('Approved','Dispatched') and ${NP('o.decided_at')} between $1::date and $2::date${scope} group by 1 order by 1`, p);
  const p2: any[] = []; const sc2 = teamScope(s, p2);
  const today = await q1<any>(`select (select count(distinct v.user_id)::int from visits v join users u on u.id=v.user_id where v.day=${TODAY}${sc2}) as present,
                                      (select count(*)::int from visits v join users u on u.id=v.user_id where v.day=${TODAY}${sc2}) as visits,
                                      (select count(*)::int from alerts a left join users u on u.id=a.user_id where a.ack_at is null${sc2}) as alerts,
                                      (select count(*)::int from alerts a left join users u on u.id=a.user_id where a.ack_at is null and a.severity='crit'${sc2}) as crit`, p2);
  const p3: any[] = []; const sc3 = teamScope(s, p3);
  const waiting = await q1<any>(`select (select count(*)::int from booklets b join users u on u.id=b.user_id where b.status='Pending'${sc3}) as booklets,
                                        (select count(*)::int from sales_orders o join users u on u.id=o.user_id where o.status='Pending'${sc3}) as orders,
                                        (select count(*)::int from claims k join users u on u.id=k.user_id where k.status='Submitted'${sc3}) as claims,
                                        (select count(*)::int from tour_plans tp join users u on u.id=tp.user_id where tp.status='Submitted'${sc3}) as plans`, p3);
  const p4: any[] = []; const sc4 = teamScope(s, p4);
  const alerts = await q<any>(`select a.rule,a.severity,a.message,a.at,u.name as person from alerts a left join users u on u.id=a.user_id where a.ack_at is null${sc4} order by a.at desc limit 6`, p4);
  const pipe = await pipeline(s, info.from, info.to);
  const regions = new Map<string, { name: string; target: number; sales: number }>();
  for (const r of rows) { const k = r.region || 'No region'; const g = regions.get(k) || { name: k, target: 0, sales: 0 }; g.target += r.target; g.sales += r.sales; regions.set(k, g); }
  return { info, team: rows.length, target: rows.reduce((a, r) => a + r.target, 0), sales: rows.reduce((a, r) => a + r.sales, 0), collection: rows.reduce((a, r) => a + r.collection, 0),
    daily, today, waiting, alerts, pipeline: pipe, regions: [...regions.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ranked: [...rows].sort((a, b) => b.score - a.score).map(r => ({ id: r.id, name: r.name, area: r.area, score: r.score })) };
}

export async function saveTargets(s: Session, b: any, ip: string | null) {
  if (!okMonth(b.month)) throw new HttpError(422, 'Choose a month.');
  const items: any[] = Array.isArray(b.items) ? b.items : []; let n = 0;
  for (const i of items) {
    const amt = Number(i.amount), uid = Number(i.user_id);
    if (!Number.isInteger(uid) || !Number.isFinite(amt) || amt < 0) throw new HttpError(422, 'Every target must be a number, zero or more.');
    const before = await q1<any>('select amount from targets where user_id=$1 and month=$2', [uid, b.month]);
    if ((before && before.amount === amt) || (!before && amt === 0)) continue;
    await q(`insert into targets(user_id,month,amount,updated_by) values($1,$2,$3,$4) on conflict(user_id,month) do update set amount=excluded.amount, updated_by=excluded.updated_by, updated_at=now()`, [uid, b.month, amt, s.id]);
    await audit(s, 'target', 'targets', uid, { month: b.month, amount: before?.amount ?? null }, { month: b.month, amount: amt }, ip); n++;
  }
  return { saved: n };
}

/* ---------------- reports ---------------- */
type Rep = { key: string; label: string; group: string; range: 'dates' | 'month' | 'none'; perm?: string; run: (s: Session, a: { from: string; to: string; month: string }) => Promise<any[]> };
const scoped = (s: Session, p: any[]) => (can(s, 'credit.manage') ? '' : teamScope(s, p));
export const REPORTS: Rep[] = [
  { key: 'visits', label: 'Visit report', group: 'Monitoring', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select v.day, u.code, u.name, c.code as customer_code, c.name as customer, c.town, to_char(v.in_at at time zone 'Asia/Kathmandu','HH24:MI') as time_in, round(extract(epoch from (v.out_at - v.in_at))/60) as minutes, v.distance_m, v.out_of_fence, v.purpose, v.person_met, v.remarks, v.next_visit from visits v join users u on u.id=v.user_id join customers c on c.id=v.customer_id where v.day between $1::date and $2::date${scoped(s, p)} order by v.in_at`, p); } },
  { key: 'out-of-location', label: 'Out-of-location visits', group: 'Monitoring', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select v.day, u.code, u.name, c.name as customer, c.town, v.distance_m, v.purpose, v.remarks from visits v join users u on u.id=v.user_id join customers c on c.id=v.customer_id where v.out_of_fence and v.day between $1::date and $2::date${scoped(s, p)} order by v.distance_m desc`, p); } },
  { key: 'coverage', label: 'Customers not visited in 30 days', group: 'Planning', range: 'none', run: s => { const p: any[] = []; return q(`select c.code, c.name as customer, c.type, c.town, u.name as assigned_to, (select max(v.day) from visits v where v.customer_id=c.id) as last_visit from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null join users u on u.id=ca.user_id where c.active and not exists(select 1 from visits v where v.customer_id=c.id and v.day > ${TODAY} - 30)${scoped(s, p)} order by u.name, c.name`, p); } },
  { key: 'tour-plan', label: 'Tour plan vs actual', group: 'Planning', range: 'month', run: (s, a) => { const p: any[] = [a.month]; return q(`select u.code, u.name, tp.status, i.day, c.name as customer, c.town, exists(select 1 from visits v where v.user_id=tp.user_id and v.customer_id=i.customer_id and v.day=i.day) as visited from tour_plans tp join tour_plan_items i on i.plan_id=tp.id join users u on u.id=tp.user_id join customers c on c.id=i.customer_id where tp.month=$1${scoped(s, p)} order by u.name, i.day`, p); } },
  { key: 'target', label: 'Target vs achievement and scorecard', group: 'Sales', range: 'month', run: async (s, a) => (await people(s, a.month)).rows.map(r => ({ code: r.code, name: r.name, role: r.role, area: r.area, region: r.region, target: r.target, approved_sales: r.sales, achievement_pct: r.ach == null ? null : Math.round(r.ach * 10) / 10, collection: r.collection, orders: r.orders, active_days: r.days_present, visits: r.visits, flagged_visits: r.flagged, planned_visits: r.planned, planned_done: r.planned_done, score: r.score, incentive: r.incentive })) },
  { key: 'orders', label: 'Sales order register', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select o.no, o.order_date, c.code as customer_code, c.name as customer, u.name as sales_officer, o.value, o.over_limit, o.status, b.no as booklet, t.name as payment_term, o.invoice_no, to_char(o.decided_at at time zone 'Asia/Kathmandu','YYYY-MM-DD HH24:MI') as decided, round(extract(epoch from (o.decided_at - o.created_at))/3600, 1) as hours_to_decide from sales_orders o join customers c on c.id=o.customer_id join users u on u.id=o.user_id left join booklets b on b.id=o.booklet_id left join payment_terms t on t.id=o.payment_term_id where o.order_date between $1::date and $2::date${scoped(s, p)} order by o.no`, p); } },
  { key: 'product-sales', label: 'Product-wise sales', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select pr.code, pr.name as product, pc.name as category, sum(i.qty)::int as boxes, sum(i.qty*i.units_per_box)::int as units, sum(i.value) as value from sales_orders o join sales_order_items i on i.order_id=o.id join products pr on pr.id=i.product_id join product_categories pc on pc.id=pr.category_id join users u on u.id=o.user_id where o.status in ('Approved','Dispatched') and o.order_date between $1::date and $2::date${scoped(s, p)} group by pr.code, pr.name, pc.name order by value desc`, p); } },
  { key: 'customer-sales', label: 'Customer-wise sales', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select c.code, c.name as customer, c.type, c.town, count(*)::int as orders, sum(o.value) as value from sales_orders o join customers c on c.id=o.customer_id join users u on u.id=o.user_id where o.status in ('Approved','Dispatched') and o.order_date between $1::date and $2::date${scoped(s, p)} group by c.code, c.name, c.type, c.town order by value desc`, p); } },
  { key: 'booklets', label: 'Booklet register', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select b.no, b.order_date, b.due_date, c.name as customer, u.name as sales_officer, b.max_variance as pct_below_base, b.final_level, b.status, pr.name as product, i.qty as boxes, i.base_rate, i.ask_rate, i.bonus_buy, i.bonus_free, i.discount_pct, i.net_rate, i.variance_pct from booklets b join booklet_items i on i.booklet_id=b.id join products pr on pr.id=i.product_id join customers c on c.id=b.customer_id join users u on u.id=b.user_id where b.order_date between $1::date and $2::date${scoped(s, p)} order by b.no`, p); } },
  { key: 'rate-variance', label: 'Rate variance by sales officer', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select u.code, u.name, count(distinct b.id)::int as booklets, round(avg(i.variance_pct),2) as avg_pct_below_base, max(i.variance_pct) as max_pct_below_base, sum(i.qty*pr.units_per_box*(i.base_rate-i.net_rate)) filter (where b.status='Accepted') as value_given_away_if_fully_ordered from booklets b join booklet_items i on i.booklet_id=b.id join products pr on pr.id=i.product_id join users u on u.id=b.user_id where b.order_date between $1::date and $2::date${scoped(s, p)} group by u.code, u.name order by avg_pct_below_base desc`, p); } },
  { key: 'stock', label: 'Distributor stock and near expiry', group: 'Sales', range: 'none', run: s => { const p: any[] = []; return q(`select c.code, c.name as distributor, pr.code as product_code, pr.name as product, i.stock, i.sold_30d, case when i.sold_30d > 0 then round(i.stock::numeric/i.sold_30d*30) end as cover_days, i.near_expiry, r.day as reported_on, u.name as reported_by from stock_reports r join stock_report_items i on i.report_id=r.id join customers c on c.id=r.customer_id join products pr on pr.id=i.product_id join users u on u.id=r.user_id where r.day=(select max(day) from stock_reports x where x.customer_id=r.customer_id)${scoped(s, p)} order by c.name, pr.name`, p); } },
  { key: 'credit', label: 'Credit exposure and aging', group: 'Money', range: 'none', perm: 'credit.manage', run: () => q(`select c.code, c.name as customer, c.town, u.name as assigned_to, c.credit_limit, coalesce(o.total,0) as outstanding, coalesce(o.b0,0) as "0-30", coalesce(o.b1,0) as "31-60", coalesce(o.b2,0) as "61-90", coalesce(o.b3,0) as "above 90", o.as_of, (select coalesce(sum(value),0) from sales_orders so where so.customer_id=c.id and so.status='Approved') as approved_not_dispatched from customers c left join outstanding_balances o on o.customer_id=c.id left join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null left join users u on u.id=ca.user_id where c.active order by coalesce(o.total,0) desc`) },
  { key: 'instruments', label: 'Instrument expiry', group: 'Money', range: 'none', perm: 'credit.manage', run: () => q(`select c.code, c.name as customer, f.type, f.bank, f.ref_no, f.amount, f.issue_date, f.expiry_date, f.status, (f.expiry_date - ${TODAY}) as days_left from financial_instruments f join customers c on c.id=f.customer_id where f.status='Active' order by f.expiry_date`) },
  { key: 'collections', label: 'Collection register', group: 'Money', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select k.day, c.code as customer_code, c.name as customer, u.name as collected_by, k.mode, k.amount, k.ref_no, k.bank, k.cheque_date, k.status, k.remarks from collections k join customers c on c.id=k.customer_id join users u on u.id=k.user_id where k.day between $1::date and $2::date${scoped(s, p)} order by k.day, k.id`, p); } },
  { key: 'claims', label: 'Claims register', group: 'Money', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select k.day, c.name as customer, u.name as raised_by, k.type, pr.name as product, k.qty as boxes, k.batch_no, k.expiry_date, k.amount, k.status, k.remarks from claims k join customers c on c.id=k.customer_id join users u on u.id=k.user_id left join products pr on pr.id=k.product_id where k.day between $1::date and $2::date${scoped(s, p)} order by k.day`, p); } },
  { key: 'alerts', label: 'Alert log', group: 'People', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select a.day, a.rule, a.severity, u.name as person, a.message, k.name as acknowledged_by, to_char(a.ack_at at time zone 'Asia/Kathmandu','YYYY-MM-DD HH24:MI') as acknowledged_at from alerts a left join users u on u.id=a.user_id left join users k on k.id=a.ack_by where a.day between $1::date and $2::date${scoped(s, p)} order by a.at`, p); } },
  { key: 'audit', label: 'Audit log', group: 'People', range: 'dates', perm: 'audit.view', run: (_s, a) => q(`select to_char(at at time zone 'Asia/Kathmandu','YYYY-MM-DD HH24:MI:SS') as at, user_name, action, entity, entity_id, before::text, after::text, ip from audit_logs where ${NP('at')} between $1::date and $2::date order by id limit 50000`, [a.from, a.to]) },
  { key: 'expiry-position', label: 'Company stock by batch and expiry risk', group: 'Stock and expiry', range: 'none', perm: 'inventory.view', run: async () => (await (await import('./inventory')).expiryPosition()).rows.map((b: any) => ({ product_code: b.code, product: b.product, batch: b.batch_no, expiry: b.expiry_date, months_left: b.months_left, location: b.location, free_boxes: b.free_boxes, sells_per_month: b.run_rate, left_over_boxes: b.at_risk, value: b.value, value_left_over: b.risk_value, offer: b.offer?.text ?? (b.expired ? 'expired' : b.unsellable ? 'below minimum shelf life' : ''), offer_rate: b.offer?.rate ?? '', stock_as_of: b.as_of })) },
  { key: 'demand-plan', label: 'Demand plan - what to make', group: 'Stock and expiry', range: 'none', perm: 'inventory.view', run: async () => (await (await import('./inventory')).demandPlan()).rows.map((r: any) => ({ product_code: r.code, product: r.product, pack: r.pack_size, sells_per_month: r.per_month, last_30_days: r.last_30, trend_pct: r.trend_pct, open_orders: r.open, sellable_stock: r.stock, will_expire: r.at_risk, cover_days: r.cover_days, make_boxes: r.make, make_value: r.make_value })) },
  { key: 'expiry-returns', label: 'Expiry returns with policy flags', group: 'Stock and expiry', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select c.day, k.code as customer_code, k.name as customer, u.name as raised_by, c.type, pr.name as product, c.qty as boxes, c.batch_no, c.expiry_date, c.amount, c.status, (select string_agg(f->>'text', ' | ') from jsonb_array_elements(c.flags) f) as policy_flags from claims c join users u on u.id=c.user_id join customers k on k.id=c.customer_id left join products pr on pr.id=c.product_id where c.type in ('Expired stock','Near expiry') and c.day between $1::date and $2::date${scoped(s, p)} order by c.day, c.id`, p); } },
  { key: 'channel', label: 'Distributor stock: bought against sold', group: 'Stock and expiry', range: 'none', perm: 'stock.view', run: async s => (await (await import('./channel')).channelHealth(s)).rows.map((r: any) => ({ customer: r.customer, town: r.town, product_code: r.product_code, product: r.product, buys_per_month: r.bought_pm, sells_per_month: r.sold_30d, stock: r.stock, on_order: r.coming, months_of_sale: r.cover_months, status: r.status, extra_boxes: r.excess, extra_value: r.excess_value, reported: r.day })) },
  { key: 'transfers', label: 'Stock to move between distributors', group: 'Stock and expiry', range: 'none', perm: 'stock.view', run: async s => (await (await import('./channel')).transfers(s)).rows.map((r: any) => ({ product: r.product, from: r.from, from_town: r.from_town, why: r.reason, to: r.to, to_town: r.to_town, to_days_of_stock: r.to_cover_days, distance: r.near, boxes: r.boxes, value: r.value })) },
  { key: 'scheme-results', label: 'Scheme results', group: 'Sales', range: 'none', perm: 'scorecard.view', run: async () => (await (await import('./pricing')).schemeResults()).map((r: any) => ({ code: r.code, scheme: r.name, product: r.product, offer: r.text, min_boxes: r.min_qty, customer_type: r.customer_type || 'all', from: r.valid_from, to: r.valid_to, running: r.running ? 'yes' : 'no', orders: r.orders, customers: r.customers, boxes: r.boxes, free_boxes: r.free_boxes, billed: r.value, given_away: r.cost, given_pct: r.cost_pct, boxes_before: r.before_boxes, boxes_during: r.during_boxes, change_pct: r.uplift_pct })) },
  { key: 'rebate', label: 'Yearly rebate position', group: 'Sales', range: 'none', perm: 'rebate.view', run: async s => (await (await import('./growth')).rebatePosition(s)).rows.map((r: any) => ({ customer: r.name, town: r.town, sales_officer: r.person, bought_this_year: r.bought, slab_pct: r.pct, earned: r.earned, next_slab_from: r.next_from, next_slab_pct: r.next_pct, more_needed: r.gap })) },
  { key: 'customer-classes', label: 'Customer classes and visit discipline', group: 'Planning', range: 'none', run: async s => (await (await import('./opps')).segments(s)).customers.map((c: any) => ({ customer: c.name, type: c.type, town: c.town, sales_officer: c.person, class: c.cls, sales_12_months: c.value, visit_every_days: c.norm_days, last_visit: c.last_visit, days_since: c.days_since, overdue: c.overdue ? 'yes' : 'no' })) },
  { key: 'action-answers', label: 'Field answers on the action list', group: 'Sales', range: 'dates', run: (s, a) => { const p: any[] = [a.from, a.to]; return q(`select (f.at at time zone 'Asia/Kathmandu')::date as day, u.code, u.name, c.name as customer, f.kind, f.outcome, f.reason from action_feedback f join users u on u.id=f.user_id left join customers c on c.id=f.customer_id where (f.at at time zone 'Asia/Kathmandu')::date between $1::date and $2::date${scoped(s, p)} order by f.at`, p); } },
];

/** Targets from a sheet with the columns "Employee code" and "Target". */
export async function importTargets(s: Session, grid: any[][], month: string, ip: string | null) {
  if (!okMonth(month)) throw new HttpError(422, 'Choose a month.');
  if (grid.length < 2) throw new HttpError(422, 'The file has a header row but no data rows.');
  const head = grid[0].map((h: any) => String(h).trim().toLowerCase()), ic = head.findIndex((h: string) => ['employee code', 'code'].includes(h)), it = head.findIndex((h: string) => ['target', 'target (rs)', 'amount'].includes(h));
  if (ic < 0 || it < 0) throw new HttpError(422, 'Columns needed: Employee code, Target. Download the template.');
  const users = new Map((await q<any>(`select u.id, u.code from users u join roles r on r.id=u.role_id where u.active and r.permissions ? 'field.use'`)).map(u => [String(u.code).toUpperCase(), u.id]));
  const items: any[] = [], errors: { row: number; message: string }[] = [];
  for (let i = 1; i < grid.length; i++) {
    const code = String(grid[i][ic] ?? '').trim().toUpperCase(), raw = grid[i][it], amt = Number(String(raw ?? '').replace(/,/g, ''));
    if (!code) continue;
    if (!users.has(code)) errors.push({ row: i + 1, message: `No active field employee has the code "${code}".` });
    else if (raw === '' || raw == null || !Number.isFinite(amt) || amt < 0) errors.push({ row: i + 1, message: 'Target must be a number, zero or more.' });
    else items.push({ user_id: users.get(code), amount: amt });
  }
  const r = await saveTargets(s, { month, items }, ip);
  return { saved: r.saved, unchanged: items.length - r.saved, failed: errors.length, errors };
}
export async function targetTemplateRows(month: string) {
  if (!okMonth(month)) throw new HttpError(422, 'Choose a month.');
  return q<any>(`select u.code as "Employee code", u.name as "Name", r.name as "Role", coalesce((select amount from targets t where t.user_id=u.id and t.month=$1),0) as "Target"
                   from users u join roles r on r.id=u.role_id where u.active and r.permissions ? 'field.use' and r.key <> 'admin' order by u.code`, [month]);
}
