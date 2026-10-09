import { api, HttpError, need } from '@/lib/auth';
import { q1 } from '@/lib/db';

export const POST = api(async req => {
  const s = await need(); const b = await req.json().catch(() => ({}));
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo || ''));
  if (!m) throw new HttpError(422, 'That is not a photo.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 600 * 1024) throw new HttpError(413, 'The photo is too large. Take it again.');
  if ((await q1<any>(`select count(*)::int n from photos where user_id=$1 and at > now() - interval '24 hours'`, [s.id]))!.n >= 60) throw new HttpError(429, 'You have attached 60 photos in the last 24 hours, which is the limit.');
  const row = await q1<any>(`insert into photos(user_id,kind,mime,data) values($1,$2,'image/jpeg',$3) returning id`, [s.id, String(b.kind || 'proof').slice(0, 20), buf]);
  return { id: row!.id };
});
