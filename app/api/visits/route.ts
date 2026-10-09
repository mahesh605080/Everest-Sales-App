import { api, HttpError, need } from '@/lib/auth';
import { visitReport } from '@/lib/field';

export const GET = api(async req => {
  const s = await need('team.view');
  const u = new URL(req.url).searchParams, ok = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(u.get('from')) || !ok(u.get('to'))) throw new HttpError(422, 'Choose a from and a to date.');
  return { visits: await visitReport(s, u.get('from')!, u.get('to')!) };
});
