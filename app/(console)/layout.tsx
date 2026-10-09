import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { getSession } from '@/lib/auth';
import { ENT } from '@/lib/entities';
import { can } from '@/lib/perm';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const overview = [{ href: '/dashboard', label: 'Dashboard' }];
  if (can(s, 'map.view')) overview.push({ href: '/map', label: can(s, 'track.view') ? 'Live map' : 'Customer map' });
  if (can(s, 'track.send')) overview.push({ href: '/location', label: 'Share my location' });
  const masters = Object.values(ENT).filter(e => can(s, `${e.key}.view`)).map(e => ({ href: `/m/${e.key}`, label: e.label }));
  const admin = [] as { href: string; label: string }[];
  if (can(s, 'roles.manage')) admin.push({ href: '/roles', label: 'Roles and permissions' });
  if (can(s, 'settings.manage')) admin.push({ href: '/settings', label: 'Settings' });
  if (can(s, 'audit.view')) admin.push({ href: '/audit', label: 'Audit log' });
  const nav = [{ group: 'Overview', items: overview }, { group: 'Masters', items: masters }, { group: 'Administration', items: admin }].filter(g => g.items.length);
  const titles: Record<string, [string, string]> = {
    '/dashboard': ['Dashboard', 'Master data health and recent changes'],
    '/map': ['Map', 'Customers and the last known position of the field team'],
    '/location': ['Share my location', 'Send your position to the control room while you are on duty'],
    '/roles': ['Roles and permissions', 'Decide what each role can see and do'],
    '/settings': ['Settings', 'Limits used by geo-fence, approvals and alerts'],
    '/audit': ['Audit log', 'Every login and every change, with who and when'],
    '/profile': ['My account', 'Change your password'],
  };
  for (const e of Object.values(ENT)) titles[`/m/${e.key}`] = [e.label, e.note || `Add, edit, import and export ${e.label.toLowerCase()}`];
  return <Shell user={{ name: s.name, role_name: s.role_name, must_change_password: s.must_change_password }} nav={nav} titles={titles}>{children}</Shell>;
}
