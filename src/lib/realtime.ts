import { accessToken, getBase, refreshNow } from './api';

/**
 * The app's one live connection to the platform service. Used while the app is open: it brings notifications, approvals and chat at once.
 * It reconnects by itself, asks for what it missed, and never passes on the same event twice.
 * When the phone suspends or closes the app this connection stops; it is not a way to wake a closed app.
 */
export type LiveEvent = { id: number; channel: string; event: string; payload: any; at: string };
type State = 'connecting' | 'open' | 'closed';

let ws: WebSocket | null = null, state: State = 'closed', wanted = false, attempt = 0, beat: any = null, timer: any = null, userId: number | null = null, ref = 0;
const listeners = new Set<(e: LiveEvent) => void>(), stateListeners = new Set<(s: State) => void>(), last = new Map<string, number>(), waiting = new Map<number, (m: any) => void>();
const setState = (s: State) => { state = s; stateListeners.forEach(f => f(s)); };
// On a phone the server address is always set at login. The browser preview has none and uses the page's own address.
const origin = () => getBase() || (typeof location !== 'undefined' ? location.origin : '');
const url = () => origin().replace(/^http/, 'ws') + '/ws';

function open() {
  if (!wanted || ws || !origin() || !accessToken()) return;
  setState('connecting');
  let sock: WebSocket;
  try { sock = new WebSocket(url()); } catch { return retry(); }
  ws = sock;
  sock.onopen = () => { sock.send(JSON.stringify({ type: 'auth', token: accessToken() })); clearInterval(beat); beat = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, 25000); };
  sock.onmessage = ev => {
    let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type === 'ready') {
      attempt = 0; userId = m.user_id; setState('open');
      for (const ch of m.channels as string[]) { if (last.has(ch)) sock.send(JSON.stringify({ type: 'subscribe', channel: ch, since: last.get(ch) })); else last.set(ch, m.last_event_id); }
    } else if (m.type === 'event') {
      if (m.id <= (last.get(m.channel) ?? 0)) return;
      last.set(m.channel, m.id); listeners.forEach(f => f(m));
    } else if (m.ref != null && waiting.has(m.ref)) { waiting.get(m.ref)!(m); waiting.delete(m.ref); }
  };
  sock.onclose = async e => {
    clearInterval(beat); if (ws === sock) ws = null; setState('closed');
    if (e.code === 4401) { const r = await refreshNow(); if (r === 'ended') return; } // the token ran out: get a new one first; if the login has ended, stop
    retry();
  };
  sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
}
function retry() {
  if (!wanted) return; clearTimeout(timer);
  timer = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.7 + Math.random() * 0.6));
}

export const realtime = {
  start() { wanted = true; open(); },
  /** Called when the app comes back to the front or the network returns. */
  wake() { if (wanted && !ws) { attempt = 0; clearTimeout(timer); open(); } },
  stop() { wanted = false; clearTimeout(timer); last.clear(); userId = null; try { ws?.close(); } catch { /* ignore */ } ws = null; setState('closed'); },
  on(fn: (e: LiveEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  onState(fn: (s: State) => void) { stateListeners.add(fn); fn(state); return () => { stateListeners.delete(fn); }; },
  ask(msg: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (ws?.readyState !== 1) return reject(new Error('Not connected.'));
      const r = ++ref; waiting.set(r, resolve); ws.send(JSON.stringify({ ...msg, ref: r }));
      setTimeout(() => { if (waiting.delete(r)) reject(new Error('The server did not answer.')); }, 10000);
    });
  },
  get userId() { return userId; },
};
