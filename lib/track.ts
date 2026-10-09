import { q } from './db';
import { Session } from './perm';

/** Last known position of each person in the last 12 hours, limited to the viewer's territory. */
export async function latestPings(s: Session) {
  const params: any[] = []; let scope = '';
  if (s.level <= 1) { params.push(s.id); scope = 'and u.id=$1'; }
  else if (s.level === 2) { params.push(s.area_id); scope = 'and u.area_id=$1'; }
  else if (s.level === 3) { params.push(s.region_id); scope = 'and u.region_id=$1'; }
  return q(`select distinct on (p.user_id) p.user_id as id, u.name, u.code, r.name as role, a.name as area, p.lat, p.lng, p.accuracy, p.at
              from location_pings p join users u on u.id=p.user_id join roles r on r.id=u.role_id left join areas a on a.id=u.area_id
             where p.at > now() - interval '12 hours' and u.active ${scope}
             order by p.user_id, p.at desc`, params);
}
