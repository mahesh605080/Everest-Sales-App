import bcrypt from 'bcryptjs';
import { q, q1 } from './db';
import { ENT, Entity, Field, relInfo } from './entities';
import { HttpError } from './auth';
import { audit } from './audit';
import { Session } from './perm';

export function entity(key: string): Entity {
  const e = ENT[key];
  if (!e) throw new HttpError(404, 'Unknown list.');
  return e;
}

/** Territory rule: field roles only see their own slice of customers and employees. */
function scope(ent: Entity, s: Session, p: (v: any) => string): string {
  const lvl = s.level;
  if (ent.key === 'customers') {
    if (lvl <= 1) return `exists(select 1 from customer_assignments x where x.customer_id=t.id and x.to_date is null and x.user_id=${p(s.id)})`;
    if (lvl === 2) return s.area_id ? `t.area_id=${p(s.area_id)}` : 'false';
    if (lvl === 3) return s.region_id ? `t.area_id in (select id from areas where region_id=${p(s.region_id)})` : 'false';
  }
  if (ent.key === 'employees') {
    if (lvl <= 1) return `t.id=${p(s.id)}`;
    if (lvl === 2) return s.area_id ? `t.area_id=${p(s.area_id)}` : `t.id=${p(s.id)}`;
    if (lvl === 3) return s.region_id ? `t.region_id=${p(s.region_id)}` : `t.id=${p(s.id)}`;
  }
  return '';
}

export type ListOpts = { search?: string; page?: number; size?: number; inactive?: boolean; id?: number };

export async function listRows(ent: Entity, s: Session, o: ListOpts = {}) {
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return '$' + params.length; };
  const cols = ['t.id', 't.active', 't.updated_at'];
  const joins: string[] = [];
  ent.fields.forEach((f, i) => {
    if (f.type === 'password' || f.virtual) return;
    cols.push(`t."${f.key}"`);
    if (f.type === 'rel') {
      const r = relInfo(f.rel!);
      joins.push(`left join ${r.table} j${i} on j${i}.id=t."${f.key}"`);
      cols.push(`j${i}.${r.label} as "${f.key}__label"`, `j${i}.${r.code} as "${f.key}__code"`);
    }
  });
  if (ent.key === 'customers') {
    joins.push('left join customer_assignments ca on ca.customer_id=t.id and ca.to_date is null left join users au on au.id=ca.user_id');
    cols.push('ca.user_id as assigned_to', 'au.name as "assigned_to__label"', 'au.code as "assigned_to__code"');
  }
  const where: string[] = [];
  const sc = scope(ent, s, p);
  if (sc) where.push(sc);
  if (!o.inactive && !o.id) where.push('t.active');
  if (o.id) where.push(`t.id=${p(o.id)}`);
  if (o.search?.trim()) {
    const n = p('%' + o.search.trim().replace(/[%_\\]/g, m => '\\' + m) + '%');
    where.push('(' + ent.search.map(c => `t."${c}" ilike ${n}`).join(' or ') + ')');
  }
  const w = where.length ? 'where ' + where.join(' and ') : '';
  const size = Math.min(Math.max(o.size || 25, 1), 5000), page = Math.max(o.page || 1, 1);
  const total = (await q1<{ n: string }>(`select count(*) n from ${ent.table} t ${joins.join(' ')} ${w}`, params))!.n;
  const rows = await q(`select ${cols.join(',')} from ${ent.table} t ${joins.join(' ')} ${w} order by t.active desc, t.code limit ${size} offset ${(page - 1) * size}`, params);
  return { rows, total: Number(total), page, size };
}

function coerce(f: Field, raw: any): any {
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    if (f.required) throw new Error(`${f.label} is required.`);
    return f.def ?? null;
  }
  switch (f.type) {
    case 'text': { const v = String(raw).trim(); if (v.length > 300) throw new Error(`${f.label} is too long.`); return f.upper ? v.toUpperCase() : v; }
    case 'int': { const n = Number(raw); if (!Number.isInteger(n) || n < 0) throw new Error(`${f.label} must be a whole number.`); return n; }
    case 'money': { const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new Error(`${f.label} must be a number, zero or more.`); return Math.round(n * 100) / 100; }
    case 'float': {
      const n = Number(raw); if (!Number.isFinite(n)) throw new Error(`${f.label} must be a number.`);
      if (f.key === 'lat' && (n < -90 || n > 90)) throw new Error('Latitude must be between -90 and 90.');
      if (f.key === 'lng' && (n < -180 || n > 180)) throw new Error('Longitude must be between -180 and 180.');
      return n;
    }
    case 'date': { const v = String(raw).trim().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new Error(`${f.label} must be a date like 2026-10-09.`); return v; }
    case 'select': { const v = String(raw).trim(); const hit = f.options!.find(x => x.toLowerCase() === v.toLowerCase()); if (!hit) throw new Error(`${f.label} must be one of: ${f.options!.join(', ')}.`); return hit; }
    case 'rel': { const n = Number(raw); if (!Number.isInteger(n) || n <= 0) throw new Error(`${f.label} is not valid.`); return n; }
  }
  return raw;
}

async function assignCustomer(customerId: number, userId: number | null, by: number) {
  const cur = await q1<{ id: number; user_id: number }>('select id,user_id from customer_assignments where customer_id=$1 and to_date is null', [customerId]);
  if ((cur?.user_id ?? null) === userId) return;
  if (cur) await q('update customer_assignments set to_date=current_date where id=$1', [cur.id]);
  if (userId) await q('insert into customer_assignments(customer_id,user_id,created_by) values($1,$2,$3)', [customerId, userId, by]);
}

const defaultPassword = () => process.env.DEFAULT_USER_PASSWORD || 'Everest@123';

export async function saveRow(ent: Entity, s: Session, id: number | null, body: any, ip: string | null) {
  const vals: Record<string, any> = {}, errs: Record<string, string> = {};
  for (const f of ent.fields) {
    if (f.type === 'password' || f.virtual) continue;
    if (id && !(f.key in body)) continue;
    try { vals[f.key] = coerce(f, body[f.key]); } catch (e: any) { errs[f.key] = e.message; }
  }
  let assigned: number | null | undefined;
  if (ent.key === 'customers' && 'assigned_to' in body) {
    try { assigned = coerce(ent.fields.find(f => f.key === 'assigned_to')!, body.assigned_to); } catch (e: any) { errs.assigned_to = e.message; }
  }
  if (ent.key === 'employees') {
    const pw = typeof body.password === 'string' ? body.password : '';
    if (pw && pw.length < 8) errs.password = 'Password must be at least 8 characters.';
    if (id && vals.manager_id === id) errs.manager_id = 'A person cannot report to themselves.';
    if (!errs.password && (pw || !id)) {
      vals.password_hash = await bcrypt.hash(pw || defaultPassword(), 10);
      vals.must_change_password = true; vals.failed_logins = 0; vals.locked_until = null;
      if (id) vals.token_version = ((await q1<any>('select token_version from users where id=$1', [id]))?.token_version ?? 0) + 1; // signs the person out everywhere
    }
  }
  if (Object.keys(errs).length) throw new HttpError(422, Object.values(errs)[0], errs);

  const before = id ? await q1(`select * from ${ent.table} where id=$1`, [id]) : null;
  if (id && !before) throw new HttpError(404, `This ${ent.one} no longer exists.`);
  const keys = Object.keys(vals);
  if (id) {
    // Nothing actually different (common when re-importing the same file): do not write or log.
    const same = keys.every(k => String(before[k] ?? '') === String(vals[k] ?? ''));
    const cur = assigned === undefined ? undefined : (await q1<any>('select user_id from customer_assignments where customer_id=$1 and to_date is null', [id]))?.user_id ?? null;
    if (same && (assigned === undefined || cur === assigned)) return { id, unchanged: true };
  }
  let row: any;
  try {
    if (id) {
      const set = keys.map((k, i) => `"${k}"=$${i + 1}`).concat(`updated_at=now()`, `updated_by=$${keys.length + 1}`);
      row = await q1(`update ${ent.table} set ${set.join(',')} where id=$${keys.length + 2} returning *`, [...keys.map(k => vals[k]), s.id, id]);
    } else {
      const all = [...keys, 'created_by', 'updated_by'];
      row = await q1(`insert into ${ent.table}(${all.map(k => `"${k}"`).join(',')}) values(${all.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, [...keys.map(k => vals[k]), s.id, s.id]);
    }
  } catch (e: any) {
    if (e.code === '23505') {
      const col = /\((.+?)\)=/.exec(e.detail || '')?.[1] || 'code';
      const f = ent.fields.find(x => x.key === col);
      throw new HttpError(409, `${f?.label || 'Code'} is already used by another ${ent.one}.`, { [col]: 'Already in use.' });
    }
    if (e.code === '23503') throw new HttpError(422, 'One of the selected values no longer exists. Reload the page and try again.');
    throw e;
  }
  if (assigned !== undefined) await assignCustomer(row.id, assigned, s.id);
  const after = assigned !== undefined ? { ...row, assigned_to: assigned } : row;
  await audit(s, id ? 'update' : 'create', ent.key, row.id, before, after, ip);
  return { id: row.id };
}

export async function setActive(ent: Entity, s: Session, id: number, active: boolean, ip: string | null) {
  if (ent.key === 'employees' && id === s.id && !active) throw new HttpError(422, 'You cannot deactivate your own account.');
  const before = await q1(`select * from ${ent.table} where id=$1`, [id]);
  if (!before) throw new HttpError(404, `This ${ent.one} no longer exists.`);
  const row = await q1(`update ${ent.table} set active=$1, updated_at=now(), updated_by=$2 where id=$3 returning *`, [active, s.id, id]);
  if (ent.key === 'employees' && !active) await q('update users set token_version=token_version+1 where id=$1', [id]);
  if (ent.key === 'employees' && !active) await q('update customer_assignments set to_date=current_date where user_id=$1 and to_date is null', [id]);
  await audit(s, active ? 'activate' : 'deactivate', ent.key, id, before, row, ip);
  return { id };
}

export async function options(rel: string) {
  const r = relInfo(rel);
  const extra = rel === 'areas' ? ', region_id' : rel === 'employees' ? ', area_id, region_id' : '';
  const rows = await q(`select id, ${r.code} as code, ${r.label} as name${extra} from ${r.table} where active order by ${r.label}`);
  return rows.map((x: any) => ({ ...x, label: rel === 'roles' ? x.name : `${x.name} (${x.code})` }));
}
