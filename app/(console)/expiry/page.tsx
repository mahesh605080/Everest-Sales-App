import Expiry from '@/components/Expiry';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'inventory.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include company stock.</p></section>;
  return <Expiry canManage={can(s, 'inventory.manage')} canOrder={can(s, 'orders.create')} canLoss={can(s, 'scorecard.view') || can(s, 'claims.settle')} />;
}
