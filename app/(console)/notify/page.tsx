import NotifySend from '@/components/NotifySend';
import { getSession } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!s || !can(s, 'notify.send')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include sending notifications.</p></section>;
  return <NotifySend broadcast={can(s, 'notify.broadcast')} manage={can(s, 'notify.manage')}
    people={await q(`select u.id, u.name, r.name as role from users u join roles r on r.id = u.role_id where u.active order by u.name`)}
    roles={await q(`select key, name from roles where active order by level desc`)} areas={await q('select id, name from areas where active order by name')} regions={await q('select id, name from regions where active order by name')} />;
}
