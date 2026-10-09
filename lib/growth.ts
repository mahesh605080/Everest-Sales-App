import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { fyLabel, fyStart } from './bs';
import { teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { expiryPosition } from './inventory';
import { listBooklets, listOrders } from './sales';
import { listReq } from './req';
import { REQ } from './reqdefs';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------- yearly volume rebate ---------------- */
export const rebateSlabs = () => q<any>('select id, from_value, pct from rebate_slabs where active order by from_value');
export async function saveRebateSlabs(s: Session, rows: any[], ip: string | null) {
  if (!Array.isArray(rows) || rows.length > 10) throw new HttpError(422, 'Give up to 10 slabs.');
  const clean = rows.map(r => ({ from: Number(r.from_value), pct: Number(r.pct) })).sort((a, b) => a.from - b.from);
  for (const [i, r] of clean.entries()) {
    if (!(r.from > 0)) throw new HttpError(422, `Slab ${i + 1}: purchases must be more than zero.`);
    if (!(r.pct > 0 && r.pct <= 20)) throw new HttpError(422, `Slab ${i + 1}: rebate must be between 0 and 20%.`);
    if (i && (r.from === clean[i - 1].from || r.pct <= clean[i - 1].pct)) throw new HttpError(422, `Slab ${i + 1}: a higher purchase slab must give a higher rebate.`);
  }
  const before = await rebateSlabs();
  await q('update rebate_slabs set active=false where active');
  for (const r of clean) await q('insert into rebate_slabs(from_value,pct) values($1,$2)', [r.from, r.pct]);
  await audit(s, 'update', 'rebate_slabs', null, { slabs: before.map((b: any) => `${b.from_value}: ${b.pct}%`) }, { slabs: clean.map(b => `${b.from}: ${b.pct}%`) }, ip);
  return { ok: true };
}
/** Where each distributor stands this fiscal year, and how little more it takes to reach the next slab. */
export async function rebatePosition(s: Session) {
  const today = (await q1<any>(`select ${TODAY}::text d`))!.d as string, start = fyStart(today), slabs = (await rebateSlabs()).map(x => ({ from: Number(x.from_value), pct: Number(x.pct) })), p: any[] = [start];
  const rows = await q<any>(
    `select c.id, c.name, c.town, (select name from users u2 join customer_assignments ca2 on ca2.user_id=u2.id where ca2.customer_id=c.id and ca2.to_date is null limit 1) as person,
            coalesce((select sum(o.value) from sales_orders o where o.customer_id=c.id and o.status in ('Approved','Dispatched') and o.order_date >= $1::date),0) as bought
       from customers c where c.active and c.type='Distributor' and exists(select 1 from customer_assignments ca join users u on u.id=ca.user_id where ca.customer_id=c.id and ca.to_date is null${teamScope(s, p)})`, p);
  const list = rows.map(r => {
    const bought = Number(r.bought), cur = [...slabs].reverse().find(x => bought >= x.from) || null, next = slabs.find(x => x.from > bought) || null;
    return { ...r, bought, pct: cur?.pct ?? 0, earned: round(bought * (cur?.pct ?? 0) / 100), next_from: next?.from ?? null, next_pct: next?.pct ?? null,
      gap: next ? round(next.from - bought) : null, next_earned: next ? round(next.from * next.pct / 100) : null };
  }).sort((a, b) => (a.gap ?? Infinity) / (a.next_from || 1) - (b.gap ?? Infinity) / (b.next_from || 1));
  return { fy: fyLabel(today), fy_start: start, slabs, rows: list, earned: list.reduce((a, r) => a + r.earned, 0), bought: list.reduce((a, r) => a + r.bought, 0) };
}

/* ---------------- fair share when stock is short ---------------- */
/**
 * Products where open orders ask for more than the sellable stock. Each customer's share follows what it normally buys
 * (90-day average), never more than it ordered, so one large order cannot empty the godown for everyone else.
 */
export async function shortage() {
  const pos = await expiryPosition(), stock = new Map<number, number>();
  for (const b of pos.rows) if (!b.expired && !b.unsellable) stock.set(b.product_id, (stock.get(b.product_id) || 0) + b.free_boxes);
  const lines = await q<any>(
    `select i.product_id, p.name as product, p.code, o.id as order_id, o.no, o.status, o.order_date, c.id as customer_id, c.name as customer, (i.qty + i.free_qty) as qty,
            coalesce((select sum(i2.qty) from sales_order_items i2 join sales_orders o2 on o2.id=i2.order_id where o2.customer_id=o.customer_id and i2.product_id=i.product_id and o2.status='Dispatched' and o2.order_date > ${TODAY} - 90),0)::numeric / 3 as usual
       from sales_order_items i join sales_orders o on o.id=i.order_id join products p on p.id=i.product_id join customers c on c.id=o.customer_id
      where o.status in ('Pending','Approved') and i.batch_id is null order by o.created_at`);
  const out: any[] = [];
  for (const pid of new Set(lines.map(l => l.product_id))) {
    if (!stock.has(pid)) continue; // no stock figures uploaded for this product: nothing to compare with
    const mine = lines.filter(l => l.product_id === pid), have = stock.get(pid)!, want = mine.reduce((a, l) => a + l.qty, 0);
    if (want <= have) continue;
    const base = mine.map(l => Math.max(Number(l.usual), 0)), useQty = base.every(b => b === 0), w = useQty ? mine.map(l => l.qty) : base.map((b, i) => b || mine[i].qty * 0.25);
    const give = mine.map(() => 0); let left = have, open = mine.map((_, i) => i);
    // Hand out in rounds: a line that is filled drops out and its unused share goes to the others.
    while (left > 0 && open.length) {
      const tw = open.reduce((a, i) => a + w[i], 0); let moved = 0;
      for (const i of [...open]) { const add = Math.min(mine[i].qty - give[i], Math.floor(left * w[i] / tw)); give[i] += add; moved += add; if (give[i] >= mine[i].qty) open = open.filter(x => x !== i); }
      left -= moved;
      if (!moved) { for (const i of open) { if (left <= 0) break; give[i]++; left--; if (give[i] >= mine[i].qty) open = open.filter(x => x !== i); } if (left > 0 && !open.length) break; }
    }
    out.push({ product_id: pid, product: mine[0].product, code: mine[0].code, stock: have, ordered: want, short: want - have,
      lines: mine.map((l, i) => ({ order_id: l.order_id, no: l.no, status: l.status, customer: l.customer, customer_id: l.customer_id, qty: l.qty, usual: round(Number(l.usual), 1), share: give[i] })) });
  }
  return { rows: out.sort((a, b) => b.short - a.short) };
}

/* ---------------- everything waiting for me ---------------- */
export async function approvalInbox(s: Session) {
  const items: any[] = [];
  if (can(s, 'booklets.approve')) { const bks = await listBooklets(s, 'inbox');
    const val = new Map((bks.length ? await q<any>('select i.booklet_id, sum(i.qty * p.units_per_box * i.net_rate) v from booklet_items i join products p on p.id=i.product_id where i.booklet_id = any($1) group by 1', [bks.map(b => b.id)]) : []).map(r => [r.booklet_id, Number(r.v)]));
    for (const b of bks) items.push({ type: 'Booklet', key: `bk${b.id}`, title: b.customer, sub: `${b.no} · ${b.person} · valid to ${b.due_date}`, note: b.max_variance != null ? `${Number(b.max_variance).toFixed(1)}% below base rate` : null,
      value: val.get(b.id) ?? null, at: b.created_at, url: `/api/booklets/${b.id}`, ok: { action: 'approve' }, no: { action: 'reject' }, href: '/booklets' }); }
  if (can(s, 'credit.manage')) for (const o of await listOrders(s, 'queue'))
    items.push({ type: 'Sales order', key: `so${o.id}`, title: o.customer, sub: `${o.no} · ${o.person} · ${o.order_date}`, note: o.over_now ? `Over credit limit: available Rs ${Math.round(o.available).toLocaleString('en-IN')}` : o.dda_expired ? 'DDA expired' : null,
      warn: !!o.over_now, value: o.value, at: o.created_at, url: `/api/orders/${o.id}`, ok: { action: 'approve' }, no: { action: 'reject' }, href: '/credit' });
  for (const def of Object.values(REQ)) {
    if (!def.steps.some(st => can(s, st.perm))) continue;
    for (const r of await listReq(def, s, 'inbox')) if (r.next)
      items.push({ type: def.one[0].toUpperCase() + def.one.slice(1), key: `${def.key}${r.id}`, title: r.customer || r.person, sub: `${r.person} · ${r.day}${r.type ? ' · ' + r.type : r.mode ? ' · ' + r.mode : ''}`,
        note: Array.isArray(r.flags) && r.flags.length ? r.flags.map((f: any) => f.text).join(' ') : null, warn: r.status === 'Submitted' && Array.isArray(r.flags) && r.flags.length > 0,
        value: r.amount ?? null, at: r.created_at, url: `/api/req/${def.key}/${r.id}`, ok: { action: 'next' }, okLabel: r.next, no: { action: 'reject' }, href: `/r/${def.key}` });
  }
  return { items: items.sort((a, b) => String(a.at).localeCompare(String(b.at))), value: items.reduce((a, i) => a + (Number(i.value) || 0), 0) };
}
