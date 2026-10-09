import Field from '@/components/Field';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function Page() {
  const s = await getSession();
  if (!can(s, 'field.use')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not record attendance or visits.</p></section>;
  return <Field />;
}
