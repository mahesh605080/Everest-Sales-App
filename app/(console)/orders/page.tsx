import Orders from '@/components/Orders';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession(); const c = can(s, 'orders.create'), v = can(s, 'sales.view');
  if (!c && !v) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include sales orders.</p></section>;
  return <Orders canCreate={c} canAll={v} />;
}
