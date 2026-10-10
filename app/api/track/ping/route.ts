import { api, HttpError, need } from '@/lib/auth';
import { q } from '@/lib/db';

const ok = (p: any) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

/** One position, or (from the mobile app) a batch collected in the background, each with the time it was taken. */
export const POST = api(async req => {
  const s = await need('track.send'), b = await req.json().catch(() => ({}));
  if (Array.isArray(b.points)) {
    const pts = b.points.filter(ok).slice(0, 500); let n = 0;
    for (const p of pts) {
      const at = Number.isFinite(p.at) && p.at > Date.now() - 7 * 864e5 && p.at <= Date.now() + 60000 ? new Date(p.at) : new Date();
      await q('insert into location_pings(user_id,lat,lng,accuracy,mocked,at) values($1,$2,$3,$4,$5,$6)', [s.id, p.lat, p.lng, Number.isFinite(p.accuracy) ? p.accuracy : null, p.mocked === true, at]); n++;
    }
    return { ok: true, saved: n };
  }
  if (!ok(b)) throw new HttpError(422, 'Location is not valid.');
  await q('insert into location_pings(user_id,lat,lng,accuracy,mocked) values($1,$2,$3,$4,$5)', [s.id, b.lat, b.lng, Number.isFinite(b.accuracy) ? b.accuracy : null, b.mocked === true]);
  return { ok: true };
});
