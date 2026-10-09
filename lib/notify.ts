import { q } from './db';

/** Puts a line in each person's notification bell. Never throws: a failed notification must not undo the real action. */
export async function notify(userIds: (number | null | undefined)[], title: string, body: string | null, link: string) {
  const ids = [...new Set(userIds.filter((x): x is number => Number.isInteger(x)))];
  if (!ids.length) return;
  try { await q('insert into notifications(user_id,title,body,link) select unnest($1::int[]), $2, $3, $4', [ids, title.slice(0, 150), body?.slice(0, 400) ?? null, link]); }
  catch (e) { console.error('notify failed', e); }
}
/** People holding a role in the creator's territory: the ASM of the area, the RSM of the region, every GM. */
export async function roleInTerritory(roleKey: string, ofUserId: number) {
  const rows = await q<any>(
    `select a.id from users a join roles r on r.id=a.role_id, users c
      where c.id=$2 and r.key=$1 and a.active and a.id <> c.id
        and (r.key not in ('asm','rsm') or (r.key='asm' and a.area_id is not distinct from c.area_id and c.area_id is not null) or (r.key='rsm' and a.region_id is not distinct from c.region_id and c.region_id is not null))`, [roleKey, ofUserId]);
  return rows.map(r => r.id as number);
}
export async function withPerm(perm: string) {
  return (await q<any>(`select u.id from users u join roles r on r.id=u.role_id where u.active and r.key <> 'admin' and r.permissions ? $1`, [perm])).map(r => r.id as number);
}
export async function managerOf(userId: number) {
  return (await q<any>('select manager_id from users where id=$1', [userId]))[0]?.manager_id as number | null;
}
