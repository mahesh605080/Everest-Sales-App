import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { call } from './api';
import { kv } from './store';

export type Fix = { lat: number; lng: number; accuracy: number | null; mocked: boolean; at: number };
const toFix = (l: Location.LocationObject): Fix => ({ lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? null, mocked: l.mocked === true, at: l.timestamp });

/** One good position for a check-in. Throws a plain-language message when location is off or refused. */
export async function getFix(): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new Error('Location permission is off. Allow location for Everest Sales in the phone settings.');
  if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) throw new Error('Location (GPS) is switched off on the phone. Turn it on and try again.');
  try { return toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })); }
  catch { const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 }); if (last) return toFix(last); throw new Error('Could not get a GPS position. Step outside or near a window and try again.'); }
}
/** A quick position for sorting by distance; never asks twice and never blocks the screen. */
export async function quickFix(): Promise<Fix | null> {
  try { const p = await Location.getForegroundPermissionsAsync(); if (!p.granted) return null; const l = (await Location.getLastKnownPositionAsync({ maxAge: 300000 })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })); return l ? toFix(l) : null; }
  catch { return null; }
}

/* ---------- route of the day, recorded in the background while on duty ---------- */
const TASK = 'everest-route', QUEUE = 'route-points';
// Runs even when the app is closed. Points are kept on the phone first, so nothing is lost without a connection.
TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return;
  const have = (await kv.get<any[]>(QUEUE)) ?? [];
  const add = (data.locations as Location.LocationObject[]).map(l => ({ lat: l.coords.latitude, lng: l.coords.longitude, accuracy: l.coords.accuracy ?? null, mocked: l.mocked === true, at: l.timestamp }));
  const all = [...have, ...add].slice(-2000); await kv.set(QUEUE, all);
  await sendRoute();
});
export async function sendRoute() {
  const pts = (await kv.get<any[]>(QUEUE)) ?? []; if (!pts.length) return 0;
  try { const batch = pts.slice(0, 500); await call('/api/track/ping', { json: { points: batch }, timeout: 15000 }); await kv.set(QUEUE, pts.slice(batch.length)); return batch.length; }
  catch { return 0; } // offline or signed out: keep them for the next try
}
export const dutyOn = async () => { try { return Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(TASK)); } catch { return false; } };
export async function startDuty() {
  if (Platform.OS === 'web') throw new Error('Route recording works only in the phone app.');
  const fg = await Location.requestForegroundPermissionsAsync(); if (!fg.granted) throw new Error('Location permission is off.');
  const bg = await Location.requestBackgroundPermissionsAsync(); if (!bg.granted) throw new Error('Choose "Allow all the time" for location, so the route is recorded while the phone is in your pocket.');
  await Location.startLocationUpdatesAsync(TASK, { accuracy: Location.Accuracy.Balanced, timeInterval: 120000, distanceInterval: 100, deferredUpdatesInterval: 120000, pausesUpdatesAutomatically: true, showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'Everest Sales: on duty', notificationBody: 'Recording your route for today. Stop it from the More tab.', notificationColor: '#1F5FD1' } });
}
export async function stopDuty() { try { if (await dutyOn()) await Location.stopLocationUpdatesAsync(TASK); } catch { /* already stopped */ } await sendRoute(); }
