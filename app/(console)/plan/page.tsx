import Plan from '@/components/Plan';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession(); const use = can(s, 'plan.use'), approve = can(s, 'plan.approve');
  if (!use && !approve) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include tour plans.</p></section>;
  return <Plan canUse={use} canApprove={approve} />;
}
