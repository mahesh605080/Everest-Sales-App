import { api, need } from '@/lib/auth';
import { q, q1 } from '@/lib/db';

export const GET = api(async () => {
  const s = await need(undefined, { allowTemporaryPassword: true });
  return { unread: (await q1<any>('select count(*)::int n from notifications where user_id=$1 and read_at is null', [s.id]))!.n,
    items: await q('select id,title,body,link,at,read_at is not null as read from notifications where user_id=$1 order by at desc limit 30', [s.id]) };
});
export const POST = api(async req => {
  const s = await need(); const { id } = await req.json().catch(() => ({}));
  if (id === 'all') await q('update notifications set read_at=now() where user_id=$1 and read_at is null', [s.id]);
  else if (Number.isInteger(id)) await q('update notifications set read_at=now() where id=$1 and user_id=$2 and read_at is null', [id, s.id]);
  return { ok: true };
});
