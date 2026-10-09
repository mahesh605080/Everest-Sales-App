import { api, need } from '@/lib/auth';
import { q } from '@/lib/db';

export const POST = api(async req => {
  const s = await need(); const { id } = await req.json().catch(() => ({}));
  if (Number.isInteger(id)) await q('insert into notice_reads(notice_id,user_id) values($1,$2) on conflict do nothing', [id, s.id]);
  return { ok: true };
});
