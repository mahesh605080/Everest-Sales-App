import { q1 } from './db';
import { teamScope, TODAY } from './field';
import { can, Session } from './perm';
import { expiryPosition } from './inventory';
import { actions } from './opps';
import { approvalInbox, shortage } from './growth';
import { EXPIRY_TYPES } from './returns';

/** The few numbers that say where sales and loss stand right now, each linked to the screen that fixes it. */
export async function pulse(s: Session) {
  const out: any[] = [];
  if (can(s, 'orders.create') || can(s, 'sales.view')) { const a = await actions(s); out.push({ k: 'actions', label: 'Chances to sell today', value: a.value, money: true, sub: `${a.total} actions on the list`, href: '/opportunities', tone: a.total ? 'good' : '' }); }
  const inbox = await approvalInbox(s);
  if (inbox.items.length || can(s, 'booklets.approve') || can(s, 'credit.manage')) out.push({ k: 'approvals', label: 'Waiting for my approval', value: inbox.items.length, sub: inbox.value ? `Rs ${Math.round(inbox.value).toLocaleString('en-IN')} held up` : 'nothing held up', href: '/approvals', tone: inbox.items.length ? 'warn' : '' });
  if (can(s, 'inventory.view')) {
    const pos = await expiryPosition();
    out.push({ k: 'risk', label: 'Stock that will not sell in time', value: pos.at_risk_value, money: true, sub: `${pos.at_risk_boxes} boxes · ${pos.rows.filter(b => b.offer).length} batches on offer`, href: '/expiry', tone: pos.at_risk_value > 0 ? 'crit' : '' });
    if (can(s, 'inventory.manage')) { const sh = await shortage(); out.push({ k: 'short', label: 'Products short of open orders', value: sh.rows.length, sub: sh.rows.length ? sh.rows.slice(0, 2).map(r => r.product).join(', ') : 'stock covers every open order', href: '/expiry', tone: sh.rows.length ? 'warn' : '' }); }
  }
  if (can(s, 'scorecard.view') || can(s, 'claims.settle')) {
    const p: any[] = [EXPIRY_TYPES], scope = teamScope(s, p);
    const r = (await q1<any>(`select coalesce((select sum(c.amount) from claims c join users u on u.id=c.user_id where c.type = any($1) and c.status not in ('Rejected','Withdrawn') and c.day > ${TODAY} - 365${scope}),0) as ret,
                                    coalesce((select sum(o.value) from sales_orders o join users u on u.id=o.user_id where o.status in ('Approved','Dispatched') and o.order_date > ${TODAY} - 365${scope}),0) as sales`, p))!;
    const cap = Number((await q1<any>(`select value from settings where key='return_cap_pct'`))?.value ?? 2), pct = Number(r.sales) > 0 ? Number(r.ret) / Number(r.sales) * 100 : null;
    out.push({ k: 'returns', label: 'Expiry returns, 12 months', value: pct == null ? '–' : pct.toFixed(1) + '%', sub: `Rs ${Math.round(Number(r.ret)).toLocaleString('en-IN')} · limit ${cap}% of sales`, href: '/expiry', tone: pct != null && pct > cap ? 'crit' : '' });
  }
  return { cards: out };
}
