import { api, need } from '@/lib/auth';
import { overview, people } from '@/lib/perf';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  if (u.get('view') === 'overview') return overview(await need('scorecard.view'), u.get('month'));
  return people(await need(['scorecard.view', 'field.use', 'targets.manage']), u.get('month'));
});
