import { api, clientIp, HttpError, need } from '@/lib/auth';
import { entity, saveRow, setActive } from '@/lib/crud';

const ctx = async (params: any) => {
  const p = await params; const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  const ent = entity(p.entity);
  return { ent, id, s: await need(`${ent.key}.edit`) };
};

export const PUT = api(async (req, { params }) => {
  const { ent, id, s } = await ctx(params);
  return saveRow(ent, s, id, await req.json(), await clientIp());
});

export const PATCH = api(async (req, { params }) => {
  const { ent, id, s } = await ctx(params);
  const { active } = await req.json();
  return setActive(ent, s, id, !!active, await clientIp());
});
