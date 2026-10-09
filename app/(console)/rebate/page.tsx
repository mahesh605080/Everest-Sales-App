import Rebate from '@/components/Rebate';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'rebate.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include the yearly rebate.</p></section>;
  return <Rebate canManage={can(s, 'rebate.manage')} canOrder={can(s, 'orders.create')} />;
}
