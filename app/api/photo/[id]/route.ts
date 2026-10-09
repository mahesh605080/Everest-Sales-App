import { api, HttpError, need } from '@/lib/auth';
import { q1 } from '@/lib/db';
import { teamScope } from '@/lib/field';
import { can } from '@/lib/perm';

export const GET = api(async (_req, { params }) => {
  const s = await need(); const id = Number((await params).id);
  const p = [id]; const wide = ['credit.manage', 'collections.verify', 'expenses.pay', 'claims.settle'].some(x => can(s, x));
  const scope = wide ? '' : can(s, 'team.view') ? teamScope(s, p) : (p.push(s.id), ' and u.id=$2');
  const ph = Number.isInteger(id) ? await q1<any>(`select ph.mime, ph.data from photos ph join users u on u.id=ph.user_id where ph.id=$1${scope}`, p) : null;
  if (!ph) throw new HttpError(404, 'Photo not found.');
  return new Response(ph.data, { headers: { 'content-type': ph.mime, 'cache-control': 'private, max-age=86400' } });
});
