import { api, clientIp, need } from '@/lib/auth';
import { entity, listRows, saveRow } from '@/lib/crud';

export const GET = api(async (req, { params }) => {
  const ent = entity((await params).entity);
  const s = await need(`${ent.key}.view`);
  const u = new URL(req.url).searchParams;
  return listRows(ent, s, { search: u.get('q') || '', page: Number(u.get('page')) || 1, size: Number(u.get('size')) || 25, inactive: u.get('inactive') === '1' });
});

export const POST = api(async (req, { params }) => {
  const ent = entity((await params).entity);
  const s = await need(`${ent.key}.edit`);
  return saveRow(ent, s, null, await req.json(), await clientIp());
});
