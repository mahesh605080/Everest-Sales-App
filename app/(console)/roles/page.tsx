import RolesMatrix from '@/components/RolesMatrix';
import { getSession } from '@/lib/auth';
import { q } from '@/lib/db';
import { can, PERM_GROUPS } from '@/lib/perm';

export default async function Roles() {
  const s = await getSession();
  if (!can(s, 'roles.manage')) return <section className="card"><h2>No access</h2><p className="sub">Only roles with "Roles and permissions" can open this page.</p></section>;
  const roles = await q('select id,key,name,level,permissions from roles where active order by level desc, id');
  return <RolesMatrix roles={roles} groups={PERM_GROUPS} />;
}
