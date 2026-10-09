import Notices from '@/components/Notices';
import { q } from '@/lib/db';

export default async function Page() {
  return <Notices roles={await q(`select key, name from roles where active and key <> 'admin' order by level desc`)} regions={await q('select id, name from regions where active order by name')} />;
}
