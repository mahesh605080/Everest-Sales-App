import Booklets from '@/components/Booklets';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession(); const c = can(s, 'booklets.create'), a = can(s, 'booklets.approve'), v = can(s, 'sales.view');
  if (!c && !a && !v) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include booklets.</p></section>;
  return <Booklets canCreate={c} canApprove={a} canAll={v} />;
}
