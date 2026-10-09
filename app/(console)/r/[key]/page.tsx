import { notFound } from 'next/navigation';
import Requests from '@/components/Requests';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';
import { REQ } from '@/lib/reqdefs';

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const def = REQ[(await params).key]; const s = await getSession();
  if (!def || !s) notFound();
  const create = can(s, def.create), decide = def.steps.some(st => can(s, st.perm)) || (!!def.view && can(s, def.view));
  if (!create && !decide) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include {def.label.toLowerCase()}.</p></section>;
  return <Requests key={def.key} def={def} canCreate={create} canDecide={decide} hasInbox={def.steps.length > 0} />;
}
