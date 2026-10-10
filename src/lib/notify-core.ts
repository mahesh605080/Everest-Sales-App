/** Decides which inbox rows and chat messages are new to this phone. Pure functions, so the rules are tested without a phone. */
export type InboxItem = { id: number; title: string; body?: string | null; link?: string | null; read: boolean };
export type Room = { id: string; title: string; unread: number; last: { id: number; text: string; sender_id: number } | null };
export type Shown = { key: string; title: string; body: string; url: string };
const MAX_AT_ONCE = 4;

/** `last` is the highest inbox id already handled; null means this phone has never looked, and then nothing old is announced. */
export function newInbox(items: InboxItem[], last: number | null): { show: Shown[]; last: number } {
  const top = items.reduce((m, i) => Math.max(m, i.id), last ?? 0);
  if (last === null) return { show: [], last: top };
  const fresh = items.filter(i => !i.read && i.id > last).sort((a, b) => a.id - b.id);
  const show = fresh.slice(-MAX_AT_ONCE).map(i => ({ key: `n-${i.id}`, title: i.title, body: i.body ?? '', url: i.link || '/notifications' }));
  if (fresh.length > MAX_AT_ONCE) show.unshift({ key: 'n-more', title: `${fresh.length - MAX_AT_ONCE} more notifications`, body: 'Open the app to see them all.', url: '/notifications' });
  return { show, last: top };
}

/** One notification per conversation with something unread that this phone has not announced yet. */
export function newChat(rooms: Room[], seen: Record<string, number> | null, me: number): { show: Shown[]; seen: Record<string, number> } {
  const next: Record<string, number> = {}; const show: Shown[] = [];
  for (const r of rooms) {
    if (!r.last) continue; next[r.id] = r.last.id;
    if (seen && r.unread > 0 && r.last.sender_id !== me && r.last.id > (seen[r.id] ?? 0)) show.push({ key: `c-${r.id}`, title: r.unread > 1 ? `${r.title} (${r.unread} new)` : r.title, body: r.last.text, url: `/chat/${r.id}` });
  }
  return { show: show.slice(0, MAX_AT_ONCE), seen: next };
}

/** Where a tap on a notification leads inside the app. Only known in-app paths; anything else opens the list. */
export function tapRoute(url: unknown, appRoute: (href: string) => string | null): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/notifications';
  if (/^\/chat(\/[0-9a-f-]{36})?$/.test(url)) return url;
  if (url === '/orders') return '/orders';
  return appRoute(url) ?? '/notifications';
}
