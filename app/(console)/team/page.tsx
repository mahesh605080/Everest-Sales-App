import Team from '@/components/Team';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'team.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include team visits.</p></section>;
  return <Team />;
}
