import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { accessToken, call, ensureConnection, hasToken, installationId } from './api';
import { singleFlight } from './flight';
import { appRoute } from './links';
import { InboxItem, newChat, newInbox, Room, Shown, tapRoute } from './notify-core';
import { kv } from './store';
import Constants from 'expo-constants';

/**
 * Notifications on the phone, without any outside push company in between.
 *
 * Android: the app itself fetches what is new from our server and shows it as a phone notification. That happens at once while the app is open
 * (live connection), every couple of minutes while "On duty" is recording the route, and otherwise when Android lets the background check run
 * (about every 15 minutes at best, later in battery saver, never after "Force stop"). A closed Android app cannot be woken instantly without
 * Google's messaging service, which this app does not use.
 * iPhone: when the server has Apple credentials, pushes come straight from Apple (APNs) and arrive with the app closed. Without them the iPhone
 * behaves like Android above, with iOS deciding when the background check runs.
 */
const native = Platform.OS !== 'web';
const INBOX_TASK = 'everest-inbox', K_LAST = 'notify-last', K_CHAT = 'notify-chat', K_APNS = 'apns-token';
export type Permission = 'granted' | 'denied' | 'ask' | 'unsupported';

if (native) {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  // Runs when the system allows it, also with the app closed. It only reads from our own server.
  TaskManager.defineTask(INBOX_TASK, async () => { try { await checkInbox(); return BackgroundTask.BackgroundTaskResult.Success; } catch { return BackgroundTask.BackgroundTaskResult.Failed; } });
}

export async function permission(): Promise<Permission> {
  if (!native) return 'unsupported';
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'denied';
}
export async function askPermission(): Promise<Permission> {
  if (!native) return 'unsupported';
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Everest Sales', importance: Notifications.AndroidImportance.HIGH });
  const p = await Notifications.requestPermissionsAsync();
  const out = p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'denied';
  if (out === 'granted') await startNotifications();
  return out;
}

const show = (s: Shown) => Notifications.scheduleNotificationAsync({ identifier: s.key, content: { title: s.title, body: s.body, data: { url: s.url }, sound: 'default' }, trigger: null }); // the same key replaces, it never doubles

/** Looks for anything new and announces it. Safe to call often and from the background: one run at a time, and nothing is announced twice. */
export const checkInbox = singleFlight(async (): Promise<number> => {
  if (!native) return 0;
  await ensureConnection();
  if (!hasToken() || (await permission()) !== 'granted') return 0;
  const viaApple = Platform.OS === 'ios' && !!(await kv.get<string>(K_APNS)); // Apple already shows these; here we only keep our place
  const front = AppState.currentState === 'active';
  let n = 0;
  const inbox = await call<{ items: InboxItem[] }>('/api/notifications', { timeout: 15000 });
  const a = newInbox(inbox.items, await kv.get<number>(K_LAST)); await kv.set(K_LAST, a.last);
  if (!viaApple) for (const s of a.show) { await show(s); n++; }
  try {
    const me = (await kv.get<{ id: number }>('user'))?.id ?? 0;
    const rooms = await call<{ rooms: Room[] }>('/api/v1/chat/rooms', { timeout: 15000 });
    const c = newChat(rooms.rooms, await kv.get<Record<string, number>>(K_CHAT), me); await kv.set(K_CHAT, c.seen);
    if (!viaApple && !front) for (const s of c.show) { await show(s); n++; } // with the app in front, chat already shows itself
  } catch { /* no chat permission, or offline: the inbox part is done */ }
  return n;
});

/** After login and at every start: background check on, and on an iPhone the Apple token registered with our server. Never asks for permission by itself. */
export async function startNotifications() {
  if (!native || !accessToken()) return;
  try { if (!(await TaskManager.isTaskRegisteredAsync(INBOX_TASK))) await BackgroundTask.registerTaskAsync(INBOX_TASK, { minimumInterval: 15 }); } catch { /* background checks are not available on this phone */ }
  if ((await permission()) !== 'granted') return;
  if (Platform.OS === 'ios') {
    try {
      const cfg = await call<{ apns: { enabled: boolean } }>('/api/v1/push/config');
      if (cfg.apns.enabled) {
        const t = await Notifications.getDevicePushTokenAsync(); // the token Apple gives this phone; it goes only to our own server
        await call('/api/v1/push/subscriptions', { json: { channel: 'apns', endpoint: String(t.data), installation_id: await installationId(), app_version: Constants.expoConfig?.version ?? null } });
        await kv.set(K_APNS, String(t.data));
      } else await kv.del(K_APNS);
    } catch { /* simulator, or no connection: tried again at the next start */ }
  }
  checkInbox().catch(() => {});
}

/** At logout, before the token is thrown away: this phone must stop getting the person's notifications. */
export async function stopNotifications() {
  if (!native) return;
  const t = await kv.get<string>(K_APNS);
  if (t) { try { await call('/api/v1/push/unsubscribe', { json: { endpoint: t }, timeout: 5000 }); } catch { /* the server also drops it when the login ends */ } }
  await kv.del(K_APNS); await kv.del(K_LAST); await kv.del(K_CHAT);
  try { await Notifications.dismissAllNotificationsAsync(); } catch { /* nothing shown */ }
  try { if (await TaskManager.isTaskRegisteredAsync(INBOX_TASK)) await BackgroundTask.unregisterTaskAsync(INBOX_TASK); } catch { /* not registered */ }
}

/** Calls `go` with an in-app route when a notification is tapped, including the tap that opened the app. */
export function onNotificationTap(go: (route: string) => void): () => void {
  if (!native) return () => {};
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (!r) return; const d: any = r.notification.request.content.data ?? {};
    const ack = d.ack ?? d.body?.ack; if (ack) call('/api/v1/notifications/ack', { json: { token: ack, clicked: true } }).catch(() => {}); // tells the server this one was really opened
    go(tapRoute(d.url ?? d.body?.url, appRoute));
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
