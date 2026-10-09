import { api, clientIp, HttpError, need } from '@/lib/auth';
import { entity } from '@/lib/crud';
import { importFile } from '@/lib/xl';
import { can } from '@/lib/perm';

export const POST = api(async (req, { params }) => {
  const ent = entity((await params).entity);
  const s = await need('import.run');
  if (!can(s, `${ent.key}.edit`)) throw new HttpError(403, 'Your role does not allow this.');
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'Choose a file to upload.');
  return importFile(ent, s, file, await clientIp());
});
