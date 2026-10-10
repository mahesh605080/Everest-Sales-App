'use client';
import { call } from './ui';

/** Push to this browser. The server's public key comes from the server; the private half never leaves it. Nothing here talks to any third-party SDK. */
export type PushState = 'unsupported' | 'off-on-server' | 'blocked' | 'on' | 'off' | 'needs-install';
const key = (b64: string) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iosTab = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone);
const save = (sub: PushSubscription) => { const j = sub.toJSON(); return call('/api/v1/push/subscriptions', { method: 'POST', json: { channel: 'webpush', endpoint: j.endpoint, keys: j.keys } }); };

export async function pushState(): Promise<PushState> {
  if (!supported()) return typeof navigator !== 'undefined' && iosTab() ? 'needs-install' : 'unsupported';   // on an iPhone, Safari allows push only after "Add to Home Screen"
  const cfg = await call('/api/v1/push/config').catch(() => null);
  if (!cfg?.webpush?.enabled) return 'off-on-server';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Must be called from a click: browsers show the permission question only then. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const cfg = await call('/api/v1/push/config');
  if (!cfg.webpush.enabled) return 'off-on-server';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const want = key(cfg.webpush.public_key), have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) { await sub.unsubscribe(); sub = null; }   // the server's key was changed: the old subscription is useless
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await save(sub);
  return 'on';
}

export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await call('/api/v1/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** On every visit: if this browser already has a subscription, make sure the server has it under the person now logged in. Never asks for permission. */
export async function syncPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
  if (sub) await save(sub).catch(() => {});
}
