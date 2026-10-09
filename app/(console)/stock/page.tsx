import Stock from '@/components/Stock';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession(); const r = can(s, 'stock.report'), v = can(s, 'stock.view');
  if (!r && !v) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include distributor stock.</p></section>;
  return <Stock canReport={r} canView={v} />;
}
