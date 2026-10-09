import { q } from './db';
import { Session } from './perm';

export async function audit(s: Pick<Session, 'id' | 'name'> | null, action: string, entity: string, entityId: any, before: any, after: any, ip: string | null) {
  const clean = (o: any) => { if (!o) return null; const { password_hash, ...rest } = o; return rest; };
  await q('insert into audit_logs(user_id,user_name,action,entity,entity_id,before,after,ip) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [s?.id ?? null, s?.name ?? null, action, entity, entityId == null ? null : String(entityId), clean(before), clean(after), ip]);
}
