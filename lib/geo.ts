'use client';
export type Pos = { lat: number; lng: number; accuracy: number };

/** Reads the phone's position once, with messages a field user can act on. */
export function getPos(): Promise<Pos> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser cannot read location.'));
    if (!window.isSecureContext) return reject(new Error('Location only works on a secure (https) address.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission was refused. Allow location for this site in the browser settings and try again.'
        : 'Could not get your position. Switch on GPS, move to open sky and try again.')),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 25000 });
  });
}
export const fmtDist = (m: number | null) => m == null ? 'no location' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
export const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }) : '–';
export const nptToday = () => new Date(Date.now() + 5.75 * 3600000).toISOString().slice(0, 10);
