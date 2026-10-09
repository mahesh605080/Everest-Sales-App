import { api, HttpError, need } from '@/lib/auth';
import { exportRows } from '@/lib/sales';
import { rowsToXlsx } from '@/lib/xl';

export const GET = api(async req => {
  await need(['credit.manage', 'dispatch.manage']);
  const day = new URL(req.url).searchParams.get('day') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(422, 'Choose a date.');
  const buf = await rowsToXlsx('Approved orders', await exportRows(day));
  return new Response(buf as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="approved-orders-${day}.xlsx"` } });
});
