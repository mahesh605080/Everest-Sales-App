import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { Session } from './perm';
import { notify, roleInTerritory } from './notify';

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
const ping = (uid: number, p: { lat: number | null; lng: number | null; acc: number | null }, mocked = false) =>
  p.lat == null ? null : q('insert into location_pings(user_id,lat,lng,accuracy,mocked) values($1,$2,$3,$4,$5)', [uid, p.lat, p.lng, p.acc, mocked]);

export async function today(s: Session, at?: { lat?: any; lng?: any }) {
  const visits = await q<any>(`select v.*, c.name as customer, c.code as customer_code from visits v join customers c on c.id=v.customer_id where v.user_id=$1 and v.day=${TODAY} order by v.in_at`, [s.id]);
  const customers = await q<any>(
    `select c.id,c.code,c.name,c.type,c.town,c.lat,c.lng,c.dda_expiry,
            (select max(in_at) from visits v where v.customer_id=c.id) as last_visit,
            exists(select 1 from tour_plan_items i join tour_plans tp on tp.id=i.plan_id where tp.user_id=$1 and tp.status='Approved' and i.customer_id=c.id and i.day=${TODAY}) as planned
       from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null
      where ca.user_id=$1 and c.active order by c.name`, [s.id]);
  const lat = Number(at?.lat), lng = Number(at?.lng), have = at?.lat != null && Number.isFinite(lat) && Number.isFinite(lng);
  for (const c of customers) c.distance_m = have && c.lat != null && c.lng != null ? metres(lat, lng, c.lat, c.lng) : null;
  if (have) customers.sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12));
  return { open: visits.find(v => !v.out_at) || null, visits, customers, radius: await setting('geo_fence_radius_m', 200), purposes: PURPOSES };
}

export async function visitStart(s: Session, b: any, ip: string | null) {
  const p = pos(b); const cid = Number(b.customer_id);
  if (await q1('select 1 from visits where user_id=$1 and out_at is null', [s.id])) throw new HttpError(409, 'Check out of the open customer visit first.');
  const c = await q1<any>(
    `select c.* from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null where c.id=$1 and ca.user_id=$2 and c.active`, [cid, s.id]);
  if (!c) throw new HttpError(403, 'This customer is not assigned to you.');
  const radius = await setting('geo_fence_radius_m', 200);
  let dist: number | null = null, out = false, captured = false;
  const mocked = b.mocked === true; // only the mobile app can tell; a faked position never fixes a customer's location
  if (mocked && (c.lat == null || c.lng == null)) throw new HttpError(422, 'This customer has no saved location yet, and the phone is using a mock location. Turn mock location off and try again.');
  if (c.lat == null || c.lng == null) {
    // First visit fixes the customer's location; after that only Admin can change it.
    await q('update customers set lat=$1, lng=$2, updated_at=now(), updated_by=$3 where id=$4', [p.lat, p.lng, s.id, c.id]);
    await audit(s, 'location-captured', 'customers', c.id, { lat: null, lng: null }, { lat: p.lat, lng: p.lng }, ip);
    dist = 0; captured = true;
  } else { dist = metres(p.lat!, p.lng!, c.lat, c.lng); out = dist > radius; }
  const row = await q1<any>(
    `insert into visits(user_id,customer_id,day,in_lat,in_lng,in_accuracy,distance_m,out_of_fence,mock_location,source) values($1,$2,${TODAY},$3,$4,$5,$6,$7,$8,$9) returning *`,
    [s.id, c.id, p.lat, p.lng, p.acc, dist, out, mocked, b.source === 'app' ? 'app' : 'web']);
  await ping(s.id, p, mocked);
  if (mocked && (await q1<any>(`select enabled from alert_rules where key='mock_location'`))?.enabled)
    await q(`insert into alerts(rule,severity,user_id,customer_id,message,day,key) values('mock_location','crit',$1,$2,$3,${TODAY},$4) on conflict(key) do nothing`,
      [s.id, c.id, `Visit at ${c.name} was started with a faked (mock) GPS location on the phone.`, `mock:${row.id}`]);
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
            (select count(*)::int from visits v where v.user_id=u.id and v.day=${d}) as visits,
            (select count(*)::int from visits v where v.user_id=u.id and v.day=${d} and v.out_of_fence) as flagged,
            (select c.name from visits v join customers c on c.id=v.customer_id where v.user_id=u.id and v.out_at is null limit 1) as at_customer,
            (select max(coalesce(v.out_at, v.in_at)) from visits v where v.user_id=u.id and v.day=${d}) as last_visit_at,
            (select min(v.in_at) from visits v where v.user_id=u.id and v.day=${d}) as first_visit_at,
            (select max(p.at) from location_pings p where p.user_id=u.id and p.at > now() - interval '12 hours') as last_ping,
            lp.lat as lat, lp.lng as lng, lp.accuracy as accuracy
       from users u join roles r on r.id=u.role_id left join areas a on a.id=u.area_id left join regions g on g.id=u.region_id
       left join lateral (select lat,lng,accuracy from location_pings p where p.user_id=u.id and p.at > now() - interval '12 hours' order by p.at desc limit 1) lp on true
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

let lastTidy = 0;
/** Housekeeping, at most every six hours: old location points and photos that were uploaded but never attached to anything. */
async function tidy() {
  if (Date.now() - lastTidy < 6 * 3600000) return; lastTidy = Date.now();
  const days = Math.max(30, Math.round(await setting('location_retention_days', 180)));
  await q(`delete from location_pings where at < now() - ($1::int * interval '1 day')`, [days]);
  await q(`delete from photos p where p.at < now() - interval '2 days'
             and not exists(select 1 from collections x where x.photo_id=p.id) and not exists(select 1 from claims x where x.photo_id=p.id) and not exists(select 1 from competitor_info x where x.photo_id=p.id)`);
}

let lastRun = 0;
/** Evaluates the time-based rules. Cheap and idempotent: every alert has a unique key, so repeats are ignored. */
export async function runAlerts(force = false) {
  if (!force && Date.now() - lastRun < 60000) return;
  lastRun = Date.now();
  const rules: Record<string, any> = Object.fromEntries((await q<any>('select * from alert_rules')).map(r => [r.key, r]));
  // Visits left open are closed at midnight.
  await tidy().catch(e => console.error('tidy failed', e));
  await q(`update visits set out_at = (day + 1)::timestamp at time zone 'Asia/Kathmandu', remarks = coalesce(remarks, 'Closed automatically at midnight') where out_at is null and day < ${TODAY}`);
  if (rules.approval_wait?.enabled) {
    const h = Math.max(1, Math.round(Number(rules.approval_wait.threshold) || 24));
    await q(`insert into alerts(rule,severity,user_id,customer_id,message,day,key)
             select 'approval_wait','info',b.user_id,b.customer_id,'Booklet '||b.no||' has waited '||floor(extract(epoch from now()-b.updated_at)/3600)::int||' hours for '||upper(b.level)||' approval.',${TODAY},'approval_wait:b:'||b.id||':'||b.level
               from booklets b where b.status='Pending' and b.updated_at < now() - ($1::int * interval '1 hour') on conflict(key) do nothing`, [h]);
    await q(`insert into alerts(rule,severity,user_id,customer_id,message,day,key)
             select 'approval_wait','info',o.user_id,o.customer_id,'Sales order '||o.no||' has waited '||floor(extract(epoch from now()-o.created_at)/3600)::int||' hours for Credit Control.',${TODAY},'approval_wait:o:'||o.id
               from sales_orders o where o.status='Pending' and o.created_at < now() - ($1::int * interval '1 hour') on conflict(key) do nothing`, [h]);
  }
  // Still waiting after the escalation hours in Settings: tell the next level up, once per booklet level / order.
  if (rules.approval_escalation?.enabled) {
    const eh = Math.max(1, Math.round(await setting('approval_escalation_hours', 48)));
    const late = await q<any>(`insert into alerts(rule,severity,user_id,customer_id,message,day,key)
        select 'approval_escalation','warn',b.user_id,b.customer_id,'Booklet '||b.no||' has waited '||floor(extract(epoch from now()-b.updated_at)/3600)::int||' hours at '||upper(b.level)||'. Escalated.',${TODAY},'approval_escalation:b:'||b.id||':'||b.level
          from booklets b where b.status='Pending' and b.updated_at < now() - ($1::int * interval '1 hour') on conflict(key) do nothing returning user_id, message, key`, [eh]);
    for (const l of late) {
      const level = l.key.split(':').pop(), up = level === 'asm' ? 'rsm' : 'gm';
      await notify(await roleInTerritory(up, l.user_id), 'Escalation: booklet approval is overdue', l.message, '/booklets');
    }
    const lateO = await q<any>(`insert into alerts(rule,severity,user_id,customer_id,message,day,key)
        select 'approval_escalation','warn',o.user_id,o.customer_id,'Sales order '||o.no||' has waited '||floor(extract(epoch from now()-o.created_at)/3600)::int||' hours for Credit Control. Escalated.',${TODAY},'approval_escalation:o:'||o.id
          from sales_orders o where o.status='Pending' and o.created_at < now() - ($1::int * interval '1 hour') on conflict(key) do nothing returning user_id, message`, [eh]);
    for (const l of lateO) await notify(await roleInTerritory('gm', l.user_id), 'Escalation: sales order approval is overdue', l.message, '/orders');
  }
  if (rules.instrument_expiry?.enabled) await q(
    `insert into alerts(rule,severity,user_id,customer_id,message,day,key)
     select 'instrument_expiry','warn',ca.user_id,f.customer_id,f.type||' '||coalesce(f.ref_no,'')||' of '||c.name||' (Rs '||to_char(f.amount,'FM99,99,99,99,990')||') '||case when f.expiry_date < ${TODAY} then 'expired on ' else 'expires on ' end||f.expiry_date||'.',${TODAY},'instrument_expiry:'||f.id||':'||f.expiry_date
       from financial_instruments f join customers c on c.id=f.customer_id left join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null
      where f.status='Active' and f.expiry_date <= ${TODAY} + $1::int on conflict(key) do nothing`, [Math.max(1, Math.round(Number(rules.instrument_expiry.threshold) || 30))]);

  // Once a week: how much company stock will not sell before it expires. Goes to the General Managers.
  if (rules.expiry_risk?.enabled) {
    const { expiryPosition } = await import('./inventory'); const pos = await expiryPosition();
    if (pos.at_risk_boxes > 0) {
      const msg = `${pos.at_risk_boxes} boxes of company stock (Rs ${Math.round(pos.at_risk_value).toLocaleString('en-IN')} at trade rate) will not sell before expiry at the current rate of sale. Open Stock and expiry to find buyers.`;
      const made = await q<any>(`insert into alerts(rule,severity,message,day,key) values('expiry_risk','warn',$1,${TODAY},'expiry_risk:'||to_char(${NPT},'IYYY-IW')) on conflict(key) do nothing returning id`, [msg]);
      if (made.length) await notify((await q<any>(`select u.id from users u join roles r on r.id=u.role_id where u.active and r.key='gm'`)).map(g => g.id), 'Stock at risk of expiry', msg, '/expiry');
    }
  }

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
  const params: any[] = []; const scope = s.role === 'cc' ? ` and a.rule in ('instrument_expiry','approval_wait','approval_escalation','expiry_risk')` : teamScope(s, params);
  return q<any>(
    `select a.id,a.rule,a.severity,a.message,a.day,a.at,a.ack_at,u.name as person,u.code as person_code,ar.name as area,k.name as ack_by
       from alerts a left join users u on u.id=a.user_id left join areas ar on ar.id=u.area_id left join users k on k.id=a.ack_by
      where ${open ? 'a.ack_at is null' : `a.ack_at is not null and a.at > now() - interval '14 days'`}${scope}
      order by a.at desc limit 300`, params);
}

export async function ackAlert(s: Session, id: number) {
  const params: any[] = [id]; const scope = s.role === 'cc' ? ` and a.rule in ('instrument_expiry','approval_wait','approval_escalation','expiry_risk')` : teamScope(s, params);
  const ok = await q1<any>(`select a.id from alerts a left join users u on u.id=a.user_id where a.id=$1 and a.ack_at is null${scope}`, params);
  if (!ok) throw new HttpError(404, 'This alert is already acknowledged or is outside your team.');
  await q('update alerts set ack_by=$1, ack_at=now() where id=$2', [s.id, id]);
  return { ok: true };
}

/** Everything one person did on one day: visits in order, and the GPS path with its length. */
export async function dayTrail(s: Session, userId: number, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(422, 'Choose a date.');
  const p: any[] = [userId]; const scope = teamScope(s, p);
  const person = Number.isInteger(userId) ? await q1<any>(`select u.id,u.code,u.name,r.name as role,a.name as area from users u join roles r on r.id=u.role_id left join areas a on a.id=u.area_id where u.id=$1${scope}`, p) : null;
  if (!person) throw new HttpError(404, 'This person is not in your team.');
  const visits = await q<any>(`select v.id,v.in_at,v.out_at,v.in_lat,v.in_lng,v.distance_m,v.out_of_fence,v.purpose,v.person_met,v.remarks,c.name as customer,c.code as customer_code,c.lat as c_lat,c.lng as c_lng
                                 from visits v join customers c on c.id=v.customer_id where v.user_id=$1 and v.day=$2::date order by v.in_at`, [userId, day]);
  const points = await q<any>(`select lat,lng,at from location_pings where user_id=$1 and (at at time zone 'Asia/Kathmandu')::date=$2::date and coalesce(accuracy,0) <= 200 order by at limit 5000`, [userId, day]);
  let m = 0; const stops: { lat: number; lng: number; from: string; minutes: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = metres(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng), gap = (Date.parse(points[i].at) - Date.parse(points[i - 1].at)) / 60000;
    if (d >= 30) m += d;
    // Barely moved for 30 minutes or more between two points: a stop worth showing.
    else if (gap >= 30) stops.push({ lat: points[i - 1].lat, lng: points[i - 1].lng, from: points[i - 1].at, minutes: Math.round(gap) });
  }
  return { person, day, visits, points, km: Math.round(m / 100) / 10, stops };
}
