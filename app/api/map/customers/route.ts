import { api, need } from '@/lib/auth';
import { listRows } from '@/lib/crud';
import { ENT } from '@/lib/entities';

export const GET = api(async () => {
  const s = await need('map.view');
  const { rows } = await listRows(ENT.customers, s, { size: 5000 });
  return { customers: rows.filter((r: any) => r.lat != null && r.lng != null).map((r: any) => ({ id: r.id, code: r.code, name: r.name, type: r.type, town: r.town, lat: r.lat, lng: r.lng, assigned: r.assigned_to__label })) };
});
