import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q } from '@/lib/db';
import { audit } from '@/lib/audit';

export const GET = api(async () => { await need(); return { settings: await q('select key,value,label,unit from settings order by key') }; });

export const PUT = api(async req => {
  const s = await need('settings.manage');
  const body = await req.json();
  const cur = await q<any>('select key,value from settings');
  const before: any = {}, after: any = {};
  for (const row of cur) {
    if (!(row.key in body)) continue;
    const v = String(body[row.key]).trim();
    if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(422, 'Every setting needs a number, zero or more.');
    if (v !== row.value) { before[row.key] = row.value; after[row.key] = v; await q('update settings set value=$1, updated_at=now(), updated_by=$2 where key=$3', [v, s.id, row.key]); }
  }
  if (Object.keys(after).length) await audit(s, 'update', 'settings', null, before, after, await clientIp());
  return { ok: true };
});
