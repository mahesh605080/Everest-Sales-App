'use client';
export const toast = (message: string) => window.dispatchEvent(new CustomEvent('sfa-toast', { detail: message }));

export class ApiError extends Error { constructor(msg: string, public status: number, public fields?: Record<string, string>) { super(msg); } }

export async function call<T = any>(url: string, opts: RequestInit & { json?: any } = {}): Promise<T> {
  const init: RequestInit = { ...opts };
  if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers = { 'content-type': 'application/json', ...(opts.headers || {}) }; }
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new ApiError('No connection to the server. Check your internet and try again.', 0); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/auth/')) { window.location.href = '/login'; }
  if (!res.ok) throw new ApiError(data.error || 'Request failed.', res.status, data.fields);
  return data as T;
}
export const rs = (n: any) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
