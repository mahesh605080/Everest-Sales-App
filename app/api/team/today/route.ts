import { api, need } from '@/lib/auth';
import { runAlerts, teamToday } from '@/lib/field';

export const GET = api(async req => {
  const s = await need('team.view');
  await runAlerts();
  return { people: await teamToday(s, new URL(req.url).searchParams.get('day') || undefined) };
});
