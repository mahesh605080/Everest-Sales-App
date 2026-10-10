import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { q1 } from './db';
import { can, Session } from './perm';

export const COOKIE = 'sfa_session';
const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is missing or too short. Set it in .env');
    return new TextEncoder().encode('dev-only-secret-change-me-please');
  }
  return new TextEncoder().encode(s);
};
export const signToken = (uid: number, tv = 0, sid?: string | null) =>
  new SignJWT({ uid, tv, ...(sid ? { sid } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret());

/* ---- the platform service keeps the list of logins (schema "platform"). The web app records its own logins there too,
        so each can be seen and ended on its own. If the platform has not been installed, these quietly do nothing. ---- */
export async function openLogin(userId: number, tv: number, ip: string | null, ua: string | null): Promise<string | null> {
  try { return (await q1<any>(`insert into platform.sessions(id,user_id,client,token_version,ip,user_agent,expires_at) values(gen_random_uuid(),$1,'web',$2,$3,$4,now() + interval '30 days') returning id`, [userId, tv, ip, ua?.slice(0, 300) ?? null]))!.id; }
  catch { return null; }
}
export async function loginEvent(outcome: string, userId: number | null, login: string | null, ip: string | null, ua: string | null, sid?: string | null) {
  try { await q1(`insert into platform.login_events(user_id,login,outcome,session_id,ip,user_agent,detail) values($1,$2,$3,$4,$5,$6,'web')`, [userId, login?.slice(0, 80) ?? null, outcome, sid ?? null, ip, ua?.slice(0, 300) ?? null]); }
  catch { /* platform not installed */ }
}
export async function closeLogin(sid: string, reason: string) {
  try { await q1(`update platform.sessions set revoked_at=now(), revoke_reason=$2 where id=$1 and revoked_at is null`, [sid, reason]); } catch { /* platform not installed */ }
}
/** The login id inside the caller's token, if it has one. */
export async function currentSid(): Promise<string | null> {
  let tok = (await cookies()).get(COOKIE)?.value;
  if (!tok) { const h = (await headers()).get('authorization'); if (h?.startsWith('Bearer ')) tok = h.slice(7); }
  if (!tok) return null;
  try { return ((await jwtVerify(tok, secret())).payload.sid as string) || null; } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  let tok = (await cookies()).get(COOKIE)?.value;
  if (!tok) { const h = (await headers()).get('authorization'); if (h?.startsWith('Bearer ')) tok = h.slice(7); }
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, secret());
    // A token tied to one login stops working the moment that login is ended, from either service.
    if (payload.sid && !(await q1('select 1 from platform.sessions where id=$1 and user_id=$2 and revoked_at is null and expires_at > now()', [payload.sid, payload.uid]))) return null;
    return await q1<Session>(
      `select u.id,u.code,u.name,u.phone,u.email,u.region_id,u.area_id,u.must_change_password,
              r.key as role,r.name as role_name,r.level,r.permissions
         from users u join roles r on r.id=u.role_id where u.id=$1 and u.active and r.active and u.token_version=$2`, [payload.uid, Number(payload.tv) || 0]);
  } catch { return null; }
}

export class HttpError extends Error {
  constructor(public status: number, msg: string, public fields?: Record<string, string>) { super(msg); }
}
export async function need(perm?: string | string[], opts: { allowTemporaryPassword?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Please log in again.');
  if (s.must_change_password && !opts.allowTemporaryPassword) throw new HttpError(403, 'Change your temporary password first.');
  const list = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
  if (list.length && !list.some(p => can(s, p))) throw new HttpError(403, 'Your role does not allow this.');
  return s;
}
export async function clientIp() {
  const h = await headers();
  // The last entry is the one our own reverse proxy added; earlier ones can be made up by the caller.
  return (h.get('x-forwarded-for') || '').split(',').pop()!.trim() || h.get('x-real-ip') || null;
}
/** Wraps a route handler so errors always come back as { error } JSON. */
export function api(fn: (req: Request, ctx: any) => Promise<any>) {
  return async (req: Request, ctx: any) => {
    try {
      // Browser requests that change data must come from this site itself.
      const origin = req.headers.get('origin');
      if (req.method !== 'GET' && origin) {
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
        if (host && new URL(origin).host !== host) throw new HttpError(403, 'Request blocked: it did not come from this site.');
      }
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, fields: e.fields }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Something went wrong on the server. Please try again.' }, { status: 500 });
    }
  };
}
