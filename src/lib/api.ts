import { Platform } from 'react-native';
import { kv, secret } from './store';
import { singleFlight } from './flight';
import { cleanBase } from './url';
export { cleanBase };

/** A refusal from the server (wrong input, no permission). `status` 0 means the server could not be reached at all. */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
  get offline() { return this.status === 0; }
}

let base = '', token: string | null = null, refreshToken: string | null = null, onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };
export const getBase = () => base;
export const hasToken = () => !!token || !!refreshToken;

export async function loadConnection() {
  base = (await kv.get<string>('server')) ?? '';
  token = await secret.get('token'); refreshToken = await secret.get('refresh');
  return { base, token: token ?? refreshToken };
}
export async function setBase(v: string) { base = cleanBase(v); await kv.set('server', base); }
/** The short access token and the long refresh token both live in the phone's encrypted keystore, never in ordinary storage. */
export async function setTokens(access: string | null, refresh?: string | null) {
  token = access; if (access) await secret.set('token', access); else await secret.del('token');
  if (refresh !== undefined) { refreshToken = refresh; if (refresh) await secret.set('refresh', refresh); else await secret.del('refresh'); }
}
export const setToken = (v: string | null) => setTokens(v, v ? undefined : null);

/** A label for this installation, made once. The server uses it to list "where am I logged in"; it proves nothing about who is using the phone. */
export async function installationId() {
  let id = await kv.get<string>('installation');
  if (!id) { id = 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); await kv.set('installation', id); }
  return id;
}
export const deviceInfo = async () => ({ installation_id: await installationId(), platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web', model: `${Platform.OS} ${Platform.Version ?? ''}`.trim().slice(0, 120) });

// The access token lasts minutes. When the server says it has run out, one refresh is made (never two at once) and the call is repeated.
const refreshOnce = singleFlight(async (): Promise<'ok' | 'offline' | 'ended'> => {
  if (!refreshToken) return 'ended';
  try {
    const res = await fetch(base + '/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (res.status >= 502 && res.status <= 504) return 'offline';
    if (!res.ok) return 'ended';
    const d = await res.json(); await setTokens(d.access_token, d.refresh_token); return 'ok';
  } catch { return 'offline'; }
});
export const accessToken = () => token;
/** Gets a fresh access token now. Used by the live connection when the server says its token has run out. */
export const refreshNow = () => refreshOnce();
const NO_REFRESH = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/password/reset'];

async function send(path: string, opts: { method?: string; json?: any; timeout?: number }) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout ?? 20000);
  try {
    return await fetch(base + path, { method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'), signal: ctl.signal,
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined });
  } catch { throw new ApiError('No connection to the server. Check mobile data or Wi-Fi.', 0); }
  finally { clearTimeout(timer); }
}

export async function call<T = any>(path: string, opts: { method?: string; json?: any; timeout?: number } = {}): Promise<T> {
  let res = await send(path, opts);
  if (res.status === 401 && !NO_REFRESH.some(p => path.startsWith(p)) && (token || refreshToken)) {
    const r = await refreshOnce();
    if (r === 'ok') res = await send(path, opts);
    else if (r === 'offline') throw new ApiError('No connection to the server. Check mobile data or Wi-Fi.', 0);
    else { await setTokens(null, null); onSignedOut?.(); } // the login has ended: password changed, logged out elsewhere, or expired
  }
  let data: any = null; try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    // A gateway error is the server being away, not a refusal: treat it like no connection so queued work is kept.
    if (res.status >= 502 && res.status <= 504) throw new ApiError('The server is not answering right now. Try again in a little while.', 0);
    throw new ApiError(data?.error || data?.message || `The server answered with an error (${res.status}).`, res.status);
  }
  return data as T;
}
