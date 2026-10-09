import { api, HttpError, need } from '@/lib/auth';
import { q } from '@/lib/db';

export const POST = api(async req => {
  const s = await need('track.send');
  const { lat, lng, accuracy } = await req.json().catch(() => ({}));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new HttpError(422, 'Location is not valid.');
  await q('insert into location_pings(user_id,lat,lng,accuracy) values($1,$2,$3,$4)', [s.id, lat, lng, Number.isFinite(accuracy) ? accuracy : null]);
  return { ok: true };
});
