import { api, HttpError, need } from '@/lib/auth';
import { monthInfo, REPORTS } from '@/lib/perf';
import { can } from '@/lib/perm';
import { rowsToXlsx } from '@/lib/xl';

export const GET = api(async (req, { params }) => {
  const s = await need('reports.run'); const key = (await params).key; const rep = REPORTS.find(r => r.key === key);
  if (!rep || (rep.perm && !can(s, rep.perm))) throw new HttpError(404, 'Report not found.');
  const u = new URL(req.url).searchParams, ok = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
  const mi = await monthInfo(u.get('month'));
  const from = ok(u.get('from')) ? u.get('from')! : mi.from, to = ok(u.get('to')) ? u.get('to')! : mi.upto;
  if (from > to) throw new HttpError(422, 'The from date is after the to date.');
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) throw new HttpError(422, 'Choose a range of at most 400 days.');
  const buf = await rowsToXlsx(rep.label.replace(/[*?:\\/[\]]/g, ' ').slice(0, 30), await rep.run(s, { from, to, month: mi.month }));
  const tag = rep.range === 'dates' ? `${from}_to_${to}` : rep.range === 'month' ? mi.month : mi.today;
  return new Response(buf as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${rep.key}-${tag}.xlsx"` } });
});
