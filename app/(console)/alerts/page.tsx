import Alerts from '@/components/Alerts';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'alerts.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include alerts.</p></section>;
  return <Alerts canManage={can(s, 'alerts.manage')} />;
}
