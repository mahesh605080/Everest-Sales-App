import SchemeResults from '@/components/SchemeResults';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'scorecard.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include scheme results.</p></section>;
  return <SchemeResults canEdit={can(s, 'schemes.edit')} />;
}
