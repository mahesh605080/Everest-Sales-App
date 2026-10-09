import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { audit } from '@/lib/audit';
import { can } from '@/lib/perm';
import { TODAY } from '@/lib/field';

export const GET = api(async () => {
  const s = await need(); const manage = can(s, 'notices.manage');
  const notices = await q(
    `select n.id,n.title,n.body,n.category,n.role_key,n.expires,n.at,u.name as by, g.name as region, r.name as role_name,
            exists(select 1 from notice_reads x where x.notice_id=n.id and x.user_id=$1) as read,
            (select count(*)::int from notice_reads x where x.notice_id=n.id) as reads
       from notices n left join users u on u.id=n.created_by left join regions g on g.id=n.region_id left join roles r on r.key=n.role_key
      where ${manage ? `n.at > now() - interval '120 days'` : `(n.expires is null or n.expires >= ${TODAY}) and (n.role_key is null or n.role_key=$2) and (n.region_id is null or n.region_id=$3)`}
      order by n.at desc limit 200`, manage ? [s.id] : [s.id, s.role, s.region_id]);
  return { notices, manage };
});

export const POST = api(async req => {
  const s = await need('notices.manage'); const b = await req.json().catch(() => ({}));
  const title = String(b.title || '').trim(), body = String(b.body || '').trim();
  if (!title || !body) throw new HttpError(422, 'A notice needs a title and a message.');
  const exp = b.expires && /^\d{4}-\d{2}-\d{2}$/.test(b.expires) ? b.expires : null;
  const row = await q1<any>('insert into notices(title,body,category,role_key,region_id,expires,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id',
    [title.slice(0, 150), body.slice(0, 4000), String(b.category || 'General').slice(0, 40), b.role_key || null, Number(b.region_id) || null, exp, s.id]);
  await audit(s, 'create', 'notices', row!.id, null, { title }, await clientIp());
  return { id: row!.id };
});
