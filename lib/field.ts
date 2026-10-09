import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { Session } from './perm';

/** All "today" logic uses Nepal time, whatever the server clock is set to. */
export const NPT = `(now() at time zone 'Asia/Kathmandu')`;
export const TODAY = `${NPT}::date`;
export const PURPOSES = ['Order', 'Payment collection', 'Complaint', 'New product', 'Tender follow-up', 'Courtesy', 'Other'];

export function metres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, t = (d: number) => d * Math.PI / 180;
  const a = Math.sin(t(lat2 - lat1) / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(t(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
const setting = async (key: string, def: number) => Number((await q1<any>('select value from settings where key=$1', [key]))?.value ?? def);

function pos(b: any, required = true) {
  const lat = Number(b?.lat), lng = Number(b?.lng), acc = Number(b?.accuracy);
  const ok = b?.lat != null && b?.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  if (!ok) { if (required) throw new HttpError(422, 'Location is needed. Allow location for this site and try again.'); return { lat: null, lng: null, acc: null }; }
  return { lat, lng, acc: Number.isFinite(acc) ? acc : null };
}
const ping = (uid: number, p: { lat: number | null; lng: number | null; acc: number | null }) =>
  p.lat == null ? null : q('insert into location_pings(user_id,lat,lng,accuracy) values($1,$2,$3,$4)', [uid, p.lat, p.lng, p.acc]);

export async function today(s: Session, at?: { lat?: any; lng?: any }) {
  const att = await q1<any>(`select * from attendance where user_id=$1 and day=${TODAY}`, [s.id]);
  const visits = await q<any>(`select v.*, c.name as customer, c.code as customer_code from visits v join customers c on c.id=v.customer_id where v.user_id=$1 and v.day=${TODAY} order by v.in_at`, [s.id]);
  const customers = await q<any>(
    `select c.id,c.code,c.name,c.type,c.town,c.lat,c.lng,c.dda_expiry,
            (select max(in_at) from visits v where v.customer_id=c.id) as last_visit
       from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null
      where ca.user_id=$1 and c.active order by c.name`, [s.id]);
  const lat = Number(at?.lat), lng = Number(at?.lng), have = at?.lat != null && Number.isFinite(lat) && Number.isFinite(lng);
  for (const c of customers) c.distance_m = have && c.lat != null && c.lng != null ? metres(lat, lng, c.lat, c.lng) : null;
  if (have) customers.sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12));
  return { attendance: att, open: visits.find(v => !v.out_at) || null, visits, customers, radius: await setting('geo_fence_radius_m', 200), purposes: PURPOSES };
}

export async function checkIn(s: Session, b: any, ip: string | null) {
  const p = pos(b); const proj = Number(b.projection);
  if (!Number.isFinite(proj) || proj < 0) throw new HttpError(422, "Enter today's sales projection in rupees (0 if none).");
  if (await q1(`select 1 from attendance where user_id=$1 and day=${TODAY}`, [s.id])) throw new HttpError(409, 'You have already checked in today.');
  const lateAfter = await setting('checkin_late_after_min', 570);
  const row = await q1<any>(
    `insert into attendance(user_id,day,in_lat,in_lng,in_accuracy,projection,late)
     values($1,${TODAY},$2,$3,$4,$5, extract(hour from ${NPT})*60+extract(minute from ${NPT}) > $6) returning *`, [s.id, p.lat, p.lng, p.acc, proj, lateAfter]);
  await ping(s.id, p); await audit(s, 'check-in', 'attendance', row.id, null, null, ip);
  return row;
}

export async function checkOut(s: Session, b: any, ip: string | null) {
  const p = pos(b); const actual = Number(b.actual);
  if (b.actual === '' || b.actual == null || !Number.isFinite(actual) || actual < 0) throw new HttpError(422, 'Enter actual sales for today in rupees (0 if none).');
  const att = await q1<any>(`select * from attendance where user_id=$1 and day=${TODAY}`, [s.id]);
  if (!att) throw new HttpError(409, 'You have not checked in today.');
  if (att.out_at) throw new HttpError(409, 'You have already checked out today.');
  if (await q1('select 1 from visits where user_id=$1 and out_at is null', [s.id])) throw new HttpError(409, 'Check out of the open customer visit first.');
  const row = await q1<any>('update attendance set out_at=now(), out_lat=$1, out_lng=$2, actual=$3 where id=$4 returning *', [p.lat, p.lng, actual, att.id]);
  await ping(s.id, p); await audit(s, 'check-out', 'attendance', row.id, null, null, ip);
  return row;
}

export async function visitStart(s: Session, b: any, ip: string | null) {
  const p = pos(b); const cid = Number(b.customer_id);
  const att = await q1<any>(`select * from attendance where user_id=$1 and day=${TODAY}`, [s.id]);
  if (!att) throw new HttpError(409, 'Check in for the day first.');
  if (att.out_at) throw new HttpError(409, 'Your day is already closed.');
  if (await q1('select 1 from visits where user_id=$1 and out_at is null', [s.id])) throw new HttpError(409, 'Check out of the open customer visit first.');
  const c = await q1<any>(
    `select c.* from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null where c.id=$1 and ca.user_id=$2 and c.active`, [cid, s.id]);
  if (!c) throw new HttpError(403, 'This customer is not assigned to you.');
  const radius = await setting('geo_fence_radius_m', 200);
  let dist: number | null = null, out = false, captured = false;
  if (c.lat == null || c.lng == null) {
    // First visit fixes the customer's location; after that only Admin can change it.
    await q('update customers set lat=$1, lng=$2, updated_at=now(), updated_by=$3 where id=$4', [p.lat, p.lng, s.id, c.id]);
    await audit(s, 'location-captured', 'customers', c.id, { lat: null, lng: null }, { lat: p.lat, lng: p.lng }, ip);
    dist = 0; captured = true;
  } else { dist = metres(p.lat!, p.lng!, c.lat, c.lng); out = dist > radius; }
  const row = await q1<any>(
    `insert into visits(user_id,customer_id,day,in_lat,in_lng,in_accuracy,distance_m,out_of_fence) values($1,$2,${TODAY},$3,$4,$5,$6,$7) returning *`,
    [s.id, c.id, p.lat, p.lng, p.acc, dist, out]);
  await ping(s.id, p);
  if (out && (await q1<any>(`select enabled from alert_rules where key='geofence'`))?.enabled)
    await q(`insert into alerts(rule,severity,user_id,customer_id,message,day,key) values('geofence','warn',$1,$2,$3,${TODAY},$4) on conflict(key) do nothing`,
      [s.id, c.id, `Visit at ${c.name} started ${dist} m from the saved location (limit ${radius} m).`, `geofence:${row.id}`]);
  return { ...row, customer: c.name, radius, captured };
}

export async function visitEnd(s: Session, b: any) {
  const p = pos(b, false);
  const v = await q1<any>('select * from visits where user_id=$1 and out_at is null', [s.id]);
  if (!v) throw new HttpError(409, 'There is no open visit to check out of.');
  const purpose = PURPOSES.find(x => x === b.purpose);
  if (!purpose) throw new HttpError(422, 'Choose the purpose of the visit.');
  const remarks = String(b.remarks || '').trim();
  if (remarks.length < 10) throw new HttpError(422, 'Write remarks of at least 10 characters.');
  const next = b.next_visit && /^\d{4}-\d{2}-\d{2}$/.test(b.next_visit) ? b.next_visit : null;
  const row = await q1<any>('update visits set out_at=now(), out_lat=$1, out_lng=$2, purpose=$3, person_met=$4, remarks=$5, next_visit=$6 where id=$7 returning *',
    [p.lat, p.lng, purpose, String(b.person_met || '').trim().slice(0, 120) || null, remarks.slice(0, 1000), next, v.id]);
  await ping(s.id, p);
  return row;
}

/** Which people a manager may see: own area (ASM), own region (RSM), everyone above that. */
export function teamScope(s: Session, params: any[], alias = 'u') {
  if (s.level >= 4) return '';
  if (s.level === 3) { params.push(s.region_id); return ` and ${alias}.region_id=$${params.length}`; }
  if (s.level === 2) { params.push(s.area_id); return ` and ${alias}.area_id=$${params.length}`; }
  params.push(s.id); return ` and ${alias}.id=$${params.length}`;
}

export async function teamToday(s: Session, day?: string) {
  const params: any[] = []; const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? (params.push(day), `$${params.length}::date`) : TODAY;
  const scope = teamScope(s, params);
  return q<any>(
    `select u.id,u.code,u.name,r.name as role,a.name as area,g.name as region,
            t.in_at,t.out_at,t.late,t.auto_closed,t.projection,t.actual,t.in_lat,t.in_lng,
            (select count(*)::int from visits v where v.user_id=u.id and v.day=${d}) as visits,
            (select count(*)::int from visits v where v.user_id=u.id and v.day=${d} and v.out_of_fence) as flagged,
            (select c.name from visits v join customers c on c.id=v.customer_id where v.user_id=u.id and v.out_at is null limit 1) as at_customer,
            (select max(coalesce(v.out_at, v.in_at)) from visits v where v.user_id=u.id and v.day=${d}) as last_visit_at,
            (select max(p.at) from location_pings p where p.user_id=u.id and p.at > now() - interval '12 hours') as last_ping
       from users u join roles r on r.id=u.role_id left join areas a on a.id=u.area_id left join regions g on g.id=u.region_id
       left join attendance t on t.user_id=u.id and t.day=${d}
      where u.active and r.permissions ? 'field.use' and r.key <> 'admin'${scope}
      order by r.level, u.name`, params);
}

export async function visitReport(s: Session, from: string, to: string) {
  const params: any[] = [from, to]; const scope = teamScope(s, params);
  return q<any>(
    `select v.id,v.day,v.in_at,v.out_at,v.distance_m,v.out_of_fence,v.purpose,v.person_met,v.remarks,v.next_visit,
            u.name as person,u.code as person_code,c.name as customer,c.code as customer_code,c.town
       from visits v join users u on u.id=v.user_id join customers c on c.id=v.customer_id
      where v.day between $1::date and $2::date${scope} order by v.in_at desc limit 2000`, params);
}

let lastRun = 0;
/** Evaluates the time-based rules. Cheap and idempotent: every alert has a unique key, so repeats are ignored. */
export async function runAlerts(force = false) {
  if (!force && Date.now() - lastRun < 60000) return;
  lastRun = Date.now();
  const rules: Record<string, any> = Object.fromEntries((await q<any>('select * from alert_rules')).map(r => [r.key, r]));
  const field = `u.active and r.permissions ? 'field.use' and r.key <> 'admin'`;

  // Days left open are closed at midnight and reported.
  const closed = await q<any>(`update attendance set out_at = (day + 1)::timestamp at time zone 'Asia/Kathmandu', auto_closed = true where out_at is null and day < ${TODAY} returning user_id, day`);
  await q(`update visits set out_at = (day + 1)::timestamp at time zone 'Asia/Kathmandu', remarks = coalesce(remarks, 'Closed automatically at midnight') where out_at is null and day < ${TODAY}`);
  if (rules.missed_checkout?.enabled) for (const c of closed)
    await q(`insert into alerts(rule,severity,user_id,message,day,key) values('missed_checkout','info',$1,$2,$3,$4) on conflict(key) do nothing`,
      [c.user_id, `Day of ${c.day} ended without a check-out; closed automatically at midnight.`, c.day, `missed_checkout:${c.user_id}:${c.day}`]);

  // Saturday is the weekly holiday.
  if (rules.no_checkin?.enabled) await q(
    `insert into alerts(rule,severity,user_id,message,day,key)
     select 'no_checkin','warn',u.id,'No check-in by '||to_char(make_time(($1::int/60), ($1::int%60), 0),'HH24:MI')||'.',${TODAY},'no_checkin:'||u.id||':'||${TODAY}
       from users u join roles r on r.id=u.role_id
      where ${field} and extract(dow from ${NPT}) <> 6
        and extract(hour from ${NPT})*60+extract(minute from ${NPT}) >= $1
        and not exists(select 1 from attendance t where t.user_id=u.id and t.day=${TODAY})
     on conflict(key) do nothing`, [Math.min(1439, Math.max(0, Math.round(Number(rules.no_checkin.threshold) || 600)))]);

  if (rules.idle?.enabled) await q(
    `insert into alerts(rule,severity,user_id,message,day,key)
     select 'idle','warn',x.user_id,'Checked in but no visit for '||floor(extract(epoch from now()-x.last)/60)::int||' minutes.',${TODAY},'idle:'||x.user_id||':'||floor(extract(epoch from x.last))::bigint
       from (select t.user_id, greatest(t.in_at, coalesce((select max(coalesce(v.out_at, v.in_at)) from visits v where v.user_id=t.user_id and v.day=t.day), t.in_at)) as last
               from attendance t join users u on u.id=t.user_id join roles r on r.id=u.role_id
              where t.day=${TODAY} and t.out_at is null and ${field}
                and not exists(select 1 from visits v where v.user_id=t.user_id and v.out_at is null)) x
      where x.last < now() - ($1::int * interval '1 minute')
     on conflict(key) do nothing`, [Math.max(5, Math.round(Number(rules.idle.threshold) || 120))]);

  // One summary per person per week, not one alert per customer.
  if (rules.coverage?.enabled) await q(
    `insert into alerts(rule,severity,user_id,message,day,key)
     select 'coverage','info',x.user_id,x.n||' assigned customers not visited in the last '||$1::int||' days.',${TODAY},'coverage:'||x.user_id||':'||to_char(${NPT},'IYYY-IW')
       from (select ca.user_id, count(*)::int n from customer_assignments ca join customers c on c.id=ca.customer_id and c.active join users u on u.id=ca.user_id and u.active
              where ca.to_date is null and ca.from_date <= ${TODAY} - $1::int
                and not exists(select 1 from visits v where v.customer_id=c.id and v.day > ${TODAY} - $1::int)
              group by ca.user_id) x
     on conflict(key) do nothing`, [Math.max(1, Math.round(Number(rules.coverage.threshold) || 30))]);
}

export async function listAlerts(s: Session, open: boolean) {
  await runAlerts();
  const params: any[] = []; const scope = teamScope(s, params);
  return q<any>(
    `select a.id,a.rule,a.severity,a.message,a.day,a.at,a.ack_at,u.name as person,u.code as person_code,ar.name as area,k.name as ack_by
       from alerts a left join users u on u.id=a.user_id left join areas ar on ar.id=u.area_id left join users k on k.id=a.ack_by
      where ${open ? 'a.ack_at is null' : `a.ack_at is not null and a.at > now() - interval '14 days'`}${scope}
      order by a.at desc limit 300`, params);
}

export async function ackAlert(s: Session, id: number) {
  const params: any[] = [id]; const scope = teamScope(s, params);
  const ok = await q1<any>(`select a.id from alerts a left join users u on u.id=a.user_id where a.id=$1 and a.ack_at is null${scope}`, params);
  if (!ok) throw new HttpError(404, 'This alert is already acknowledged or is outside your team.');
  await q('update alerts set ack_by=$1, ack_at=now() where id=$2', [s.id, id]);
  return { ok: true };
}
