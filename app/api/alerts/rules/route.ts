import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';

export const GET = api(async () => { await need('alerts.view'); return { rules: await q('select * from alert_rules order by sort') }; });

export const PUT = api(async req => {
  const s = await need('alerts.manage'); const b = await req.json().catch(() => ({}));
  const before = await q1<any>('select * from alert_rules where key=$1', [b.key]);
  if (!before) throw new HttpError(404, 'Unknown rule.');
  let th = before.threshold;
  if (before.threshold != null && b.threshold !== undefined) {
    th = Number(b.threshold);
    if (b.threshold === '' || !Number.isFinite(th) || th < 0) throw new HttpError(422, 'The limit must be a number, zero or more.');
  }
  const after = await q1('update alert_rules set enabled=$1, threshold=$2 where key=$3 returning *', [b.enabled === undefined ? before.enabled : !!b.enabled, th, b.key]);
  await audit(s, 'update', 'alert_rules', b.key, before, after, await clientIp());
  return { ok: true };
});
