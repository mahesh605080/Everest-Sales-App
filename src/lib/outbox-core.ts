/** Work done without a connection waits here and is sent, oldest first, when the server can be reached. Pure logic, no phone APIs. */
export type OutItem = { ref: string; kind: 'order' | 'collection' | 'stock'; path: string; body: any; title: string; sub: string; at: number; tries: number; error?: string };
export type SendResult = { ok: true; data: any } | { ok: false; offline: boolean; message: string };

export function enqueue(list: OutItem[], item: Omit<OutItem, 'at' | 'tries'>, now = Date.now()): OutItem[] {
  if (list.some(x => x.ref === item.ref)) return list; // the same tap twice
  return [...list, { ...item, at: now, tries: 0 }];
}

/**
 * Sends what is waiting. A refusal by the server (for example "only 20 boxes left") keeps the item with its reason,
 * so the person can read it and decide; it is not retried by itself. Losing the connection stops the run and keeps everything.
 */
export async function flush(list: OutItem[], send: (it: OutItem) => Promise<SendResult>): Promise<{ list: OutItem[]; sent: OutItem[]; stopped: boolean }> {
  const keep: OutItem[] = [], sent: OutItem[] = []; let stopped = false;
  for (const it of list) {
    if (stopped || it.error) { keep.push(it); continue; }
    const r = await send(it);
    if (r.ok) sent.push(it);
    else if (r.offline) { stopped = true; keep.push({ ...it, tries: it.tries + 1 }); }
    else keep.push({ ...it, tries: it.tries + 1, error: r.message });
  }
  return { list: keep, sent, stopped };
}
export const retry = (list: OutItem[], ref: string) => list.map(x => (x.ref === ref ? { ...x, error: undefined } : x));
export const remove = (list: OutItem[], ref: string) => list.filter(x => x.ref !== ref);
export const waiting = (list: OutItem[]) => list.filter(x => !x.error).length;
export const refused = (list: OutItem[]) => list.filter(x => !!x.error).length;
