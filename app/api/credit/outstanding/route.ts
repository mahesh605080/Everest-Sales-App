import { api, clientIp, HttpError, need } from '@/lib/auth';
import { q } from '@/lib/db';
import { importOutstanding, outstandingTemplate } from '@/lib/xl';

export const GET = api(async req => {
  await need('credit.manage');
  if (new URL(req.url).searchParams.get('template') === '1')
    return new Response((await outstandingTemplate()) as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="outstanding-template.xlsx"' } });
  return { uploads: await q(`select o.id,o.as_of,o.file_name,o.rows_ok,o.rows_failed,o.at,u.name as by from outstanding_uploads o left join users u on u.id=o.uploaded_by order by o.at desc limit 20`) };
});
export const POST = api(async req => {
  const s = await need('credit.manage'); const fd = await req.formData(); const file = fd.get('file');
  if (!(file instanceof File)) throw new HttpError(422, 'Choose a file to upload.');
  return importOutstanding(s, file, String(fd.get('as_of') || ''), String(fd.get('mode') || ''), await clientIp());
});
