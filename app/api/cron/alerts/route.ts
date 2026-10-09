import { api, HttpError } from '@/lib/auth';
import { runAlerts } from '@/lib/field';

/** For a scheduler: checks the alert rules even when nobody has a page open. Needs CRON_SECRET in the environment. */
export const GET = api(async req => {
  const secret = process.env.CRON_SECRET, given = new URL(req.url).searchParams.get('key') || req.headers.get('x-cron-key');
  if (!secret || secret.length < 16 || given !== secret) throw new HttpError(403, 'Not allowed.');
  await runAlerts(true);
  return { ok: true };
});
