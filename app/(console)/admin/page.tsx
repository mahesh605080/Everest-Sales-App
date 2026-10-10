import AdminConsole from '@/components/AdminConsole';
import { getSession } from '@/lib/auth';

export default async function Page() {
  const s = await getSession();
  // The service checks this again on every request; this only decides what the page shows.
  if (!s || s.level < 5) return <section className="card"><h2>No access</h2><p className="sub">The platform console is for the Super Admin.</p></section>;
  return <AdminConsole />;
}
