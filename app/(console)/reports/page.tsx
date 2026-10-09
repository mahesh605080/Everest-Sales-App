import Reports from '@/components/Reports';
import { getSession } from '@/lib/auth';
import { REPORTS } from '@/lib/perf';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'reports.run')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include reports.</p></section>;
  return <Reports reports={REPORTS.filter(r => !r.perm || can(s, r.perm)).map(r => ({ key: r.key, label: r.label, group: r.group, range: r.range }))} />;
}
