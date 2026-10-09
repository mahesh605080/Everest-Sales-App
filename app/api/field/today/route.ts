import { api, need } from '@/lib/auth';
import { today } from '@/lib/field';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  return today(await need('field.use'), { lat: u.get('lat'), lng: u.get('lng') });
});
