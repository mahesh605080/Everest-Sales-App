import Credit from '@/components/Credit';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession(); const c = can(s, 'credit.manage'), d = can(s, 'dispatch.manage');
  if (!c && !d) return <section className="card"><h2>No access</h2><p className="sub">Only Credit Control can open this page.</p></section>;
  return <Credit canCredit={c} canDispatch={d} />;
}
