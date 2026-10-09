import { api, HttpError, need } from '@/lib/auth';
import { entity } from '@/lib/crud';
import { exportXlsx } from '@/lib/xl';
import { can } from '@/lib/perm';

export const GET = api(async (req, { params }) => {
  const ent = entity((await params).entity);
  const template = new URL(req.url).searchParams.get('template') === '1';
  const s = await need(template ? ['import.run', 'export.run'] : 'export.run');
  if (!can(s, `${ent.key}.view`)) throw new HttpError(403, 'Your role does not allow this.');
  const buf = await exportXlsx(ent, s, template);
  return new Response(buf as any, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${ent.key}${template ? '-template' : ''}.xlsx"`,
  } });
});
