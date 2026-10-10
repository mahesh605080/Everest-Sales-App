import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, call } from './api';
import { kv } from './store';

type Cached<T> = { at: number; data: T };
const mem = new Map<string, Cached<any>>();
const key = (path: string) => 'c:' + path;

/** Fetch and remember. When the server cannot be reached, the last answer kept on the phone is returned instead. */
export async function fetchCached<T = any>(path: string): Promise<{ data: T; at: number; stale: boolean }> {
  try { const data = await call<T>(path); const c = { at: Date.now(), data }; mem.set(path, c); kv.set(key(path), c); return { ...c, stale: false }; }
  catch (e) {
    if (e instanceof ApiError && e.offline) { const c = mem.get(path) ?? (await kv.get<Cached<T>>(key(path))); if (c) { mem.set(path, c); return { ...c, stale: true }; } }
    throw e;
  }
}
export const peek = async <T = any>(path: string) => mem.get(path) ?? (await kv.get<Cached<T>>(key(path)));
export const forget = () => { mem.clear(); return kv.clearPrefix('c:'); };

/**
 * A screen's data: shows what the phone already has at once, then refreshes from the server.
 * `stale` is true when the server could not be reached and the figures are the saved ones.
 */
export function useData<T = any>(path: string | null) {
  const [state, set] = useState<{ data: T | null; at: number; stale: boolean; loading: boolean; error: string }>({ data: null, at: 0, stale: false, loading: !!path, error: '' });
  const live = useRef(true); const cur = useRef(path); cur.current = path;
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    if (!quiet) set(s => ({ ...s, loading: true, error: '' }));
    try { const r = await fetchCached<T>(path); if (live.current && cur.current === path) set({ data: r.data, at: r.at, stale: r.stale, loading: false, error: '' }); }
    catch (e: any) { if (live.current && cur.current === path) set(s => ({ ...s, loading: false, error: e?.message ?? 'Could not load.' })); }
  }, [path]);
  useEffect(() => {
    live.current = true; if (!path) { set({ data: null, at: 0, stale: false, loading: false, error: '' }); return; }
    let cancelled = false;
    (async () => { const c = await peek<T>(path); if (!cancelled && c) set(s => (s.data ? s : { ...s, data: c.data, at: c.at })); })();
    load();
    return () => { cancelled = true; live.current = false; };
  }, [path, load]);
  return { ...state, reload: () => load(false), refresh: () => load(true) };
}
