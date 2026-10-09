import MapView from '@/components/MapView';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/perm';

export default async function MapPage() {
  const s = await getSession();
  if (!can(s, 'map.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include the map.</p></section>;
  return <MapView canTrack={can(s, 'track.view')} styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL || ''} />;
}
