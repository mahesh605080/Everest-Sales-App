import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { api, clientIp, COOKIE, HttpError, need, signToken } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';

export const POST = api(async req => {
  const s = await need(undefined, { allowTemporaryPassword: true });
  const { current, next } = await req.json().catch(() => ({}));
  if (!current || !next) throw new HttpError(422, 'Enter your current password and a new one.');
  if (String(next).length < 8) throw new HttpError(422, 'New password must be at least 8 characters.');
  if (next === current) throw new HttpError(422, 'New password must be different from the current one.');
  const u = await q1<any>('select password_hash from users where id=$1', [s.id]);
  if (!(await bcrypt.compare(String(current), u.password_hash))) throw new HttpError(401, 'Current password is wrong.');
  // Raising token_version signs out every other device; this device gets a fresh session below.
  const row = await q1<any>('update users set password_hash=$1, must_change_password=false, token_version=token_version+1, updated_at=now() where id=$2 returning token_version', [await bcrypt.hash(String(next), 10), s.id]);
  await audit(s, 'password-change', 'auth', s.id, null, null, await clientIp());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await signToken(s.id, row.token_version), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false' });
  return res;
});
