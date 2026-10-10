'use client';
/**
 * One live connection to the platform service for the whole browser tab.
 * It reconnects by itself, asks for the events it missed while it was away, and never hands the same event to a listener twice.
 */
type Listener = (e: { id: number; channel: string; event: string; payload: any; at: string }) => void;
type State = 'connecting' | 'open' | 'closed';

const url = () => process.env.NEXT_PUBLIC_PLATFORM_WS || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let ws: WebSocket | null = null, state: State = 'closed', wanted = false, attempt = 0, beat: any = null, userId: number | null = null;
const listeners = new Set<Listener>(), stateListeners = new Set<(s: State) => void>(), channels = new Set<string>(), last = new Map<string, number>(), waiting = new Map<number, (m: any) => void>();
let ref = 0;
const setState = (s: State) => { state = s; stateListeners.forEach(f => f(s)); };

function open() {
  if (!wanted || ws) return;
  setState('connecting');
  let sock: WebSocket;
  try { sock = new WebSocket(url()); } catch { return retry(); }
  ws = sock;
  sock.onmessage = ev => {
    let m: any; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'ready') {
      attempt = 0; userId = m.user_id; setState('open');
      // Everything we listen to, from where we left off. The first time there is nothing to catch up on.
      for (const ch of [...m.channels, ...channels]) sock.send(JSON.stringify({ type: 'subscribe', channel: ch, ...(last.has(ch) ? { since: last.get(ch) } : {}) }));
      for (const ch of m.channels) if (!last.has(ch)) last.set(ch, m.last_event_id);
    } else if (m.type === 'event') {
      if (m.id <= (last.get(m.channel) ?? 0)) return; // seen before the reconnect
      last.set(m.channel, m.id); listeners.forEach(f => f(m));
    } else if (m.ref != null && waiting.has(m.ref)) { waiting.get(m.ref)!(m); waiting.delete(m.ref); }
  };
  sock.onopen = () => { clearInterval(beat); beat = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, 25000); };
  sock.onclose = () => { clearInterval(beat); if (ws === sock) ws = null; setState('closed'); retry(); };
  sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
}
function retry() {
  if (!wanted) return;
  const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.7 + Math.random() * 0.6); // back off, with jitter so everyone does not return at once
  setTimeout(open, wait);
}

export const realtime = {
  start() { if (typeof window === 'undefined' || wanted) return; wanted = true; open(); window.addEventListener('online', () => { if (!ws) open(); }); },
  on(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  onState(fn: (s: State) => void) { stateListeners.add(fn); fn(state); return () => { stateListeners.delete(fn); }; },
  subscribe(channel: string) { channels.add(channel); if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', channel })); },
  /** Sends a message and resolves with the server's answer to it. */
  ask(msg: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (ws?.readyState !== 1) return reject(new Error('Not connected.'));
      const r = ++ref; waiting.set(r, resolve); ws.send(JSON.stringify({ ...msg, ref: r }));
      setTimeout(() => { if (waiting.delete(r)) reject(new Error('The server did not answer.')); }, 10000);
    });
  },
  get userId() { return userId; },
  get state() { return state; },
};
