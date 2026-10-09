import { api, HttpError, need } from '@/lib/auth';
import { options } from '@/lib/crud';
import { ENT } from '@/lib/entities';

export const GET = api(async (_req, { params }) => {
  const s = await need();
  const key = (await params).entity;
  if (key !== 'roles' && !ENT[key]) throw new HttpError(404, 'Unknown list.');
  return { options: await options(key, s) };
});
