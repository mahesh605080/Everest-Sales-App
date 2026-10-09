import Scorecard from '@/components/Scorecard';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'scorecard.view') && !can(s, 'targets.manage')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include the scorecard.</p></section>;
  return <Scorecard canTargets={can(s, 'targets.manage')} />;
}
