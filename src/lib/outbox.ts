import { useEffect, useState } from 'react';
import { ApiError, call } from './api';
import { kv } from './store';
import { enqueue, flush, OutItem, remove, retry } from './outbox-core';

const KEY = 'outbox';
let list: OutItem[] = [], loaded = false, busy = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());
const save = async (next: OutItem[]) => { list = next; await kv.set(KEY, list); emit(); };
export async function loadOutbox() { if (!loaded) { list = (await kv.get<OutItem[]>(KEY)) ?? []; loaded = true; emit(); } return list; }

/** Try the server first; if it cannot be reached, keep the work on the phone and send it later. */
export async function submit(item: Omit<OutItem, 'at' | 'tries'>): Promise<{ queued: boolean; data?: any }> {
  await loadOutbox();
  try { return { queued: false, data: await call(item.path, { json: item.body }) }; }
  catch (e) { if (e instanceof ApiError && e.offline) { await save(enqueue(list, item)); return { queued: true }; } throw e; }
}
export async function sync(): Promise<{ sent: number; left: number }> {
  await loadOutbox(); if (busy || !list.length) return { sent: 0, left: list.length };
  busy = true;
  try {
    const r = await flush(list, async it => {
      try { return { ok: true, data: await call(it.path, { json: it.body }) }; }
      catch (e) { const a = e as ApiError; return { ok: false, offline: !(e instanceof ApiError) || a.offline || a.status === 401, message: a?.message ?? 'Could not be sent.' }; }
    });
    await save(r.list); return { sent: r.sent.length, left: r.list.length };
  } finally { busy = false; }
}
export const retryItem = async (ref: string) => { await save(retry(list, ref)); return sync(); };
export const removeItem = (ref: string) => save(remove(list, ref));
export const clearOutbox = () => save([]);

export function useOutbox() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); loadOutbox(); return () => { subs.delete(f); }; }, []);
  return list;
}
