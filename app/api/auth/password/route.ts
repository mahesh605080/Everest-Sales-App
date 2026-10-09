import bcrypt from 'bcryptjs';
import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';

export const POST = api(async req => {
  const s = await need();
  const { current, next } = await req.json().catch(() => ({}));
  if (!current || !next) throw new HttpError(422, 'Enter your current password and a new one.');
  if (String(next).length < 8) throw new HttpError(422, 'New password must be at least 8 characters.');
  if (next === current) throw new HttpError(422, 'New password must be different from the current one.');
  const u = await q1<any>('select password_hash from users where id=$1', [s.id]);
  if (!(await bcrypt.compare(String(current), u.password_hash))) throw new HttpError(401, 'Current password is wrong.');
  await q('update users set password_hash=$1, must_change_password=false, updated_at=now() where id=$2', [await bcrypt.hash(String(next), 10), s.id]);
  await audit(s, 'password-change', 'auth', s.id, null, null, await clientIp());
  return { ok: true };
});
