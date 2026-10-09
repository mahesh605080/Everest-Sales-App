import ShareLocation from '@/components/ShareLocation';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function LocationPage() {
  const s = await getSession();
  if (!can(s, 'track.send')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not share location.</p></section>;
  return <ShareLocation />;
}
