import { api, need } from '@/lib/auth';
import { dayTrail } from '@/lib/field';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  return dayTrail(await need('team.view'), Number(u.get('user')), u.get('day') || '');
});
