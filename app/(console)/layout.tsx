import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { getSession } from '@/lib/auth';
import { ENT } from '@/lib/entities';
import { can } from '@/lib/perm';
import { q1 } from '@/lib/db';
import { TODAY } from '@/lib/field';
import { toBs } from '@/lib/bs';
import Profile from './profile/page';
import { REQ } from '@/lib/reqdefs';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const overview = [{ href: '/dashboard', label: 'Dashboard' }];
  if (can(s, 'map.view')) overview.push({ href: '/map', label: can(s, 'track.view') ? 'Live map' : 'Customer map' });
  if (can(s, 'track.send')) overview.push({ href: '/location', label: 'Share my location' });
  const masters = Object.values(ENT).filter(e => !['tenders', 'schemes', 'rates'].includes(e.key) && can(s, `${e.key}.view`)).map(e => ({ href: `/m/${e.key}`, label: e.label }));
  const admin = [] as { href: string; label: string }[];
  if (can(s, 'roles.manage')) admin.push({ href: '/roles', label: 'Roles and permissions' });
  if (can(s, 'settings.manage')) admin.push({ href: '/settings', label: 'Settings' });
  if (can(s, 'audit.view')) admin.push({ href: '/audit', label: 'Audit log' });
  const field = [] as { href: string; label: string }[];
  if (can(s, 'field.use')) field.push({ href: '/field', label: 'My visits' });
  if (can(s, 'plan.use') || can(s, 'plan.approve')) field.push({ href: '/plan', label: 'Tour plan' });
  if (can(s, 'team.view')) field.push({ href: '/team', label: 'Team visits' }, { href: '/visits', label: 'Visit report' });
  if (can(s, 'alerts.view')) field.push({ href: '/alerts', label: 'Alerts' });
  if (can(s, 'booklets.approve') || can(s, 'credit.manage') || Object.values(REQ).some(d => d.steps.some(st => can(s, st.perm)))) overview.push({ href: '/approvals', label: 'Approvals' });
  overview.push({ href: '/notices', label: 'Notices' });
  if (can(s, 'chat.use')) overview.push({ href: '/chat', label: 'Chat' });
  if (can(s, 'files.use')) overview.push({ href: '/files', label: 'Files' });
  const sales = [] as { href: string; label: string }[];
  if (can(s, 'orders.create') || can(s, 'sales.view')) sales.push({ href: '/opportunities', label: 'Sales opportunities' });
  if (can(s, 'booklets.create') || can(s, 'booklets.approve') || can(s, 'sales.view')) sales.push({ href: '/booklets', label: 'Booklets' });
  if (can(s, 'orders.create') || can(s, 'sales.view')) sales.push({ href: '/orders', label: 'Sales orders' });
  if (can(s, 'credit.manage') || can(s, 'dispatch.manage')) sales.push({ href: '/credit', label: 'Credit control' });
  if (can(s, 'inventory.view')) sales.push({ href: '/expiry', label: 'Stock and expiry' });
  if (can(s, 'schemes.view')) sales.push({ href: '/m/schemes', label: 'Schemes' });
  if (can(s, 'rates.view')) sales.push({ href: '/m/rates', label: 'Price lists' });
  if (can(s, 'rebate.view')) sales.push({ href: '/rebate', label: 'Yearly rebate' });
  if (can(s, 'tenders.view')) sales.push({ href: '/m/tenders', label: 'Tenders' });
  const money = Object.values(REQ).filter(d => can(s, d.create) || d.steps.some(st => can(s, st.perm)) || (!!d.view && can(s, d.view))).map(d => ({ href: `/r/${d.key}`, label: d.label }));
  if (can(s, 'stock.report') || can(s, 'stock.view')) money.push({ href: '/stock', label: 'Distributor stock' });
  const perf = [] as { href: string; label: string }[];
  if (can(s, 'scorecard.view') || can(s, 'targets.manage')) perf.push({ href: '/scorecard', label: 'Targets and scorecard' });
  if (can(s, 'scorecard.view')) perf.push({ href: '/scheme-results', label: 'Scheme results' });
  if (can(s, 'reports.run')) perf.push({ href: '/reports', label: 'Reports' });
  const nav = [{ group: 'Overview', items: overview }, { group: 'Field', items: field }, { group: 'Sales', items: sales }, { group: 'Money and requests', items: money }, { group: 'Performance', items: perf }, { group: 'Masters', items: masters }, { group: 'Administration', items: admin }].filter(g => g.items.length);
  const titles: Record<string, [string, string]> = {
    '/dashboard': [can(s, 'scorecard.view') ? 'Control room' : 'Dashboard', can(s, 'scorecard.view') ? 'Sales, field activity, alerts and decisions waiting, for your territory' : 'Your customers and quick links'],
    '/map': ['Map', 'Customers and the last known position of the field team'],
    '/location': ['Share my location', 'Send your position to the control room while this page is open'],
    '/field': ['My visits', 'Check in at a customer, take the order, and see who to sell to today'],
    '/team': ['Team visits', 'Who has visited whom today, and which visits were away from the customer'],
    '/visits': ['Visit report', 'Every customer visit with time, distance and remarks'],
    '/alerts': ['Alerts', 'What the system caught on its own, and the rules behind it'],
    '/plan': ['Tour plan', 'Plan next month\'s visits, get them approved, and compare with what was done'],
    '/notices': ['Notices', 'Messages from head office'],
    '/booklets': ['Booklets', 'Special rate and scheme requests, with multi-level approval'],
    '/orders': ['Sales orders', 'Orders sent to Credit Control, with the credit check result'],
    '/credit': ['Credit control', 'Order approval, limits, instruments, outstanding upload and dispatch'],
    '/scorecard': ['Targets and scorecard', 'Month target, achievement, score and incentive for every field person'],
    '/reports': ['Reports', 'Excel downloads for monitoring, sales, money and people'],
    '/customers': ['Customer', 'Everything about one customer in one place'],
    '/opportunities': ['Sales opportunities', 'Approved rates not yet ordered, customers who stopped ordering, distributors running low'],
    '/expiry': ['Stock and expiry', 'Which batches will not sell before they expire, who can use them in time, and at what offer'],
    '/scheme-results': ['Scheme results', 'What each scheme sold, what it cost, and whether sales really went up'],
    '/files': ['Files', 'Keep documents and photos, private until you share them'],
    '/chat': ['Chat', 'Write to colleagues; messages arrive at once'],
    '/approvals': ['Approvals', 'Everything waiting for your decision, oldest first'],
    '/rebate': ['Yearly rebate', 'What each distributor has earned this fiscal year and how close it is to the next slab'],
    '/roles': ['Roles and permissions', 'Decide what each role can see and do'],
    '/settings': ['Settings', 'Limits used by geo-fence, approvals and alerts'],
    '/audit': ['Audit log', 'Every login and every change, with who and when'],
    '/profile': ['My account', 'Change your password'],
  };
  for (const d of Object.values(REQ)) titles[`/r/${d.key}`] = [d.label, d.intro];
  titles['/stock'] = ['Distributor stock', 'What each distributor holds, how fast it sells and what is near expiry'];
  for (const e of Object.values(ENT)) titles[`/m/${e.key}`] = [e.label, e.note || `Add, edit, import and export ${e.label.toLowerCase()}`];
  // Phone: four most-used screens in a bar at the bottom, everything else behind "More".
  const have = new Set(nav.flatMap(g => g.items.map(i => i.href)));
  const order: [string, string][] = can(s, 'scorecard.view') ? [['/dashboard', 'Home'], ['/team', 'Team'], ['/approvals', 'Approvals'], ['/alerts', 'Alerts'], ['/map', 'Map']]
    : can(s, 'credit.manage') ? [['/dashboard', 'Home'], ['/approvals', 'Approvals'], ['/credit', 'Credit'], ['/r/collections', 'Collections'], ['/reports', 'Reports']]
      : can(s, 'field.use') ? [['/field', 'Visits'], ['/opportunities', 'To sell'], ['/orders', 'Orders'], ['/booklets', 'Booklets'], ['/dashboard', 'Home']]
        : [['/dashboard', 'Home'], ['/m/employees', 'Employees'], ['/roles', 'Roles'], ['/audit', 'Audit']];
  const primary = order.filter(([h]) => have.has(h)).slice(0, 4).map(([href, label]) => ({ href, label }));
  const ad = (await q1<any>(`select ${TODAY}::text d`))!.d as string;
  const today = new Date(ad + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' · ' + toBs(ad).text + ' BS';
  // A person on a temporary password can do nothing until it is changed.
  return <Shell user={{ name: s.name, role_name: s.role_name, must_change_password: s.must_change_password }} nav={s.must_change_password ? [] : nav} primary={s.must_change_password ? [] : primary} titles={titles} today={today}>{s.must_change_password ? <Profile /> : children}</Shell>;
}
