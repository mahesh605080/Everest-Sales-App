import { Platform } from 'react-native';
import { kv, secret } from './store';
import { cleanBase } from './url';
export { cleanBase };

/** A refusal from the server (wrong input, no permission). `status` 0 means the server could not be reached at all. */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
  get offline() { return this.status === 0; }
}

let base = '', token: string | null = null, onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };
export const getBase = () => base;
export const hasToken = () => !!token;

export async function loadConnection() {
  base = (await kv.get<string>('server')) ?? (Platform.OS === 'web' ? '' : '');
  token = await secret.get('token');
  return { base, token };
}
export async function setBase(v: string) { base = cleanBase(v); await kv.set('server', base); }
export async function setToken(v: string | null) { token = v; if (v) await secret.set('token', v); else await secret.del('token'); }

export async function call<T = any>(path: string, opts: { method?: string; json?: any; timeout?: number } = {}): Promise<T> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout ?? 20000);
  let res: Response;
  try {
    res = await fetch(base + path, { method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'), signal: ctl.signal,
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined });
  } catch {
    throw new ApiError('No connection to the server. Check mobile data or Wi-Fi.', 0);
  } finally { clearTimeout(timer); }
  let data: any = null; try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    // A 401 anywhere except the two password screens means the session has ended (password changed elsewhere, or expired).
    if (res.status === 401 && token && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/password')) { await setToken(null); onSignedOut?.(); }
    // A gateway error is the server being away, not a refusal: treat it like no connection so queued work is kept.
    if (res.status >= 502 && res.status <= 504) throw new ApiError('The server is not answering right now. Try again in a little while.', 0);
    throw new ApiError(data?.error || data?.message || `The server answered with an error (${res.status}).`, res.status);
  }
  return data as T;
}
