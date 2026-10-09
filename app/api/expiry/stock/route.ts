import { api, clientIp, HttpError, need } from '@/lib/auth';
import { importStock, stockTemplate, uploads } from '@/lib/inventory';

export const GET = api(async req => {
  await need('inventory.manage');
  if (new URL(req.url).searchParams.get('template') === '1')
    return new Response((await stockTemplate()) as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="stock-template.xlsx"' } });
  return { uploads: await uploads() };
});
export const POST = api(async req => {
  const s = await need('inventory.manage'); const fd = await req.formData(); const file = fd.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'Choose a file to upload.');
  return importStock(s, file, String(fd.get('as_of') || ''), String(fd.get('mode') || ''), await clientIp());
});
