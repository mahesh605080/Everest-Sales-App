import Chat from '@/components/Chat';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!s || !can(s, 'chat.use')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include chat.</p></section>;
  return <Chat me={s.id} />;
}
