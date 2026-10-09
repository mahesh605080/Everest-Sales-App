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
export const signToken = (uid: number, tv = 0) =>
  new SignJWT({ uid, tv }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret());

export async function getSession(): Promise<Session | null> {
  let tok = (await cookies()).get(COOKIE)?.value;
  if (!tok) { const h = (await headers()).get('authorization'); if (h?.startsWith('Bearer ')) tok = h.slice(7); }
  if (!tok) return null;
  try {
    const { payload } = await jwtVerify(tok, secret());
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
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null;
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
