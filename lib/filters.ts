export type ListFilter = { status?: string | null; q?: string | null; from?: string | null; to?: string | null };
const isDate = (d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Reads ?status=&q=&from=&to= from a request. */
export function readFilter(url: string): ListFilter {
  const u = new URL(url).searchParams;
  return { status: u.get('status'), q: u.get('q'), from: u.get('from'), to: u.get('to') };
}
/** Adds " and ..." conditions for the filter, pushing values onto the parameter list. */
export function filterSql(p: any[], f: ListFilter | undefined, cols: { status: string; text: string[]; date: string }) {
  let w = '';
  if (!f) return w;
  if (f.status) { p.push(f.status); w += ` and ${cols.status}=$${p.length}`; }
  if (f.q?.trim()) { p.push('%' + f.q.trim().replace(/[%_\\]/g, m => '\\' + m) + '%'); w += ' and (' + cols.text.map(c => `${c} ilike $${p.length}`).join(' or ') + ')'; }
  if (isDate(f.from)) { p.push(f.from); w += ` and ${cols.date} >= $${p.length}::date`; }
  if (isDate(f.to)) { p.push(f.to); w += ` and ${cols.date} <= $${p.length}::date`; }
  return w;
}
