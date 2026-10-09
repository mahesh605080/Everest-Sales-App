import { notFound } from 'next/navigation';
import Master from '@/components/Master';
import { getSession } from '@/lib/auth';
import { ENT } from '@/lib/entities';
import { can } from '@/lib/perm';

export default async function Page({ params }: { params: Promise<{ entity: string }> }) {
  const ent = ENT[(await params).entity];
  const s = await getSession();
  if (!ent || !s) notFound();
  if (!can(s, `${ent.key}.view`)) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include this list. Ask the Admin if you need it.</p></section>;
  const edit = can(s, `${ent.key}.edit`);
  return <Master key={ent.key} ent={ent} canEdit={edit} canImport={edit && can(s, 'import.run')} canExport={can(s, 'export.run')} />;
}
