import SettingsForm from '@/components/SettingsForm';
import { getSession } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/perm';

export default async function Settings() {
  const s = await getSession();
  if (!can(s, 'settings.manage')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include settings.</p></section>;
  return <SettingsForm settings={await q('select key,value,label,unit from settings order by label')} />;
}
