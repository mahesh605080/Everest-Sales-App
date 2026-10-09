import { api, clientIp, HttpError, need } from '@/lib/auth';
import { importTargets, saveTargets, targetTemplateRows } from '@/lib/perf';
import { readGrid, rowsToXlsx } from '@/lib/xl';

export const PUT = api(async req => saveTargets(await need('targets.manage'), await req.json().catch(() => ({})), await clientIp()));

export const GET = api(async req => {
  await need('targets.manage'); const month = new URL(req.url).searchParams.get('month') || '';
  return new Response((await rowsToXlsx('Targets', await targetTemplateRows(month))) as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="targets-${month}.xlsx"` } });
});

export const POST = api(async req => {
  const s = await need('targets.manage'); const fd = await req.formData(); const file = fd.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'Choose a file to upload.');
  return importTargets(s, await readGrid(file), String(fd.get('month') || ''), await clientIp());
});
