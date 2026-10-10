import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';
import { ALL_PERMS } from '@/lib/perm';

export const GET = api(async () => {
  await need('roles.manage');
  return { roles: await q('select id,key,name,level,permissions from roles where active order by level desc, id') };
});

export const PUT = api(async req => {
  const s = await need('roles.manage');
  const { id, permissions } = await req.json();
  if (!Array.isArray(permissions)) throw new HttpError(422, 'Nothing to save.');
  const clean = [...new Set(permissions.filter((p: any) => ALL_PERMS.includes(p)))];
  const before = await q1<any>('select * from roles where id=$1', [id]);
  if (!before) throw new HttpError(404, 'Role not found.');
  if (s.level < 5) {
    // Below the Super Admin: only roles under your own level, and only permissions you hold yourself. This stops anyone granting themselves more.
    if (before.level >= s.level) throw new HttpError(403, 'Only the Super Admin can change this role.');
    const had: string[] = before.permissions || [], extra = clean.filter((p: string) => !had.includes(p) && !s.permissions.includes(p)); // what the role already has may stay
    if (extra.length) throw new HttpError(403, `You cannot give a permission you do not have yourself: ${extra.slice(0, 3).join(', ')}.`);
  }
  if (before.key === s.role && !clean.includes('roles.manage')) throw new HttpError(422, 'You cannot remove "Roles and permissions" from your own role; you would lock yourself out.');
  const after = await q1('update roles set permissions=$1, updated_at=now() where id=$2 returning *', [JSON.stringify(clean), id]);
  await audit(s, 'update', 'roles', id, before, after, await clientIp());
  return { ok: true };
});
