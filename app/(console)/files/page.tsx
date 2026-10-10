import Files from '@/components/Files';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!s || !can(s, 'files.use')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include file storage.</p></section>;
  return <Files canAll={can(s, 'files.manage')} />;
}
