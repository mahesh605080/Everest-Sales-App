import Opportunities from '@/components/Opportunities';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'orders.create') && !can(s, 'sales.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include sales.</p></section>;
  return <Opportunities canOrder={can(s, 'orders.create')} />;
}
