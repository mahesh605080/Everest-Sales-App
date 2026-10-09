import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { api, clientIp, COOKIE, HttpError, signToken } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';

const MAX_FAILS = 5, LOCK_MIN = 15;
// Wrong logins per network address. Held in memory: enough to stop password guessing from one place on a single server.
const IP_MAX = Number(process.env.LOGIN_MAX_FAILS_PER_IP) || 20, IP_WINDOW = 15 * 60000;
const g = globalThis as any; const ipFails: Map<string, { n: number; until: number }> = g.__sfaLoginFails || (g.__sfaLoginFails = new Map());
const blocked = (ip: string | null) => { if (!ip) return false; const f = ipFails.get(ip); if (f && f.until < Date.now()) { ipFails.delete(ip); return false; } return !!f && f.n >= IP_MAX; };
const miss = (ip: string | null) => { if (!ip) return; const f = ipFails.get(ip); if (f && f.until > Date.now()) f.n++; else ipFails.set(ip, { n: 1, until: Date.now() + IP_WINDOW }); if (ipFails.size > 5000) for (const [k, v] of ipFails) if (v.until < Date.now()) ipFails.delete(k); };

export const POST = api(async req => {
  const { login, password } = await req.json().catch(() => ({}));
  if (!login || !password) throw new HttpError(422, 'Enter your employee code or mobile number, and your password.');
  const ip = await clientIp();
  if (blocked(ip)) throw new HttpError(429, 'Too many wrong logins from this network. Wait 15 minutes and try again.');
  const u = await q1<any>(
    `select u.*, r.key as role, r.name as role_name from users u join roles r on r.id=u.role_id
      where upper(u.code)=upper($1) or u.phone=$1`, [String(login).trim()]);
  const wrong = new HttpError(401, 'Employee code or password is wrong.');
  if (!u || !u.active) { miss(ip); throw wrong; }
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw new HttpError(423, `Too many wrong attempts. Try again after ${LOCK_MIN} minutes or ask Admin to reset your password.`);
  if (!(await bcrypt.compare(String(password), u.password_hash))) {
    const fails = u.failed_logins + 1;
    await q(`update users set failed_logins=$1, locked_until=$2 where id=$3`,
      [fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null, u.id]);
    if (fails >= MAX_FAILS) await audit(u, 'lockout', 'auth', u.id, null, null, ip);
    miss(ip); throw wrong;
  }
  await q('update users set failed_logins=0, locked_until=null, last_login_at=now() where id=$1', [u.id]);
  await audit(u, 'login', 'auth', u.id, null, null, ip);
  const token = await signToken(u.id, u.token_version);
  const res = NextResponse.json({ token, user: { id: u.id, code: u.code, name: u.name, role: u.role, role_name: u.role_name, must_change_password: u.must_change_password } });
  res.cookies.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
  });
  return res;
});
