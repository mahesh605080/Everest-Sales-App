'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@/lib/ui';
import { fmtDist, fmtTime, nptToday } from '@/lib/geo';

type Cust = { id: number; code: string; name: string; type: string; town: string; lat: number; lng: number; assigned: string | null };
const COLORS: Record<string, string> = { Distributor: '#1C5CAB', Hospital: '#0CA30C', Institution: '#4A3AA7', Retailer: '#EB6834' };
const STATUS: Record<string, { color: string; pill: string }> = { 'On visit': { color: '#0CA30C', pill: 'good' }, 'Visited today': { color: '#2A78D6', pill: 'info' }, 'No visit yet': { color: '#FAB219', pill: 'warn' } };
// OpenStreetMap raster tiles: works without a key. For production traffic use a provider style URL (see README).
const OSM: any = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ago = (at: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
export function statusOf(p: any): string { return p.at_customer ? 'On visit' : p.visits > 0 ? 'Visited today' : 'No visit yet'; }

export default function MapView({ canTrack, canTeam, styleUrl }: { canTrack: boolean; canTeam: boolean; styleUrl: string }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null), ready = useRef(false);
  const custMarkers = useRef<maplibregl.Marker[]>([]), peopleMarkers = useRef<maplibregl.Marker[]>([]), trailMarkers = useRef<maplibregl.Marker[]>([]);
  const [cust, setCust] = useState<Cust[]>([]); const [people, setPeople] = useState<any[]>([]);
  const [type, setType] = useState('All'); const [region, setRegion] = useState('All'); const [showCust, setShowCust] = useState(true);
  const [err, setErr] = useState(''); const [mapErr, setMapErr] = useState('');
  const [sel, setSel] = useState<number | null>(null); const [day, setDay] = useState(nptToday()); const [trail, setTrail] = useState<any>(null);
  const shown = useMemo(() => showCust ? cust.filter(c => type === 'All' || c.type === type) : [], [cust, type, showCust]);
  const team = useMemo(() => people.filter(p => region === 'All' || p.region === region), [people, region]);
  const regions = useMemo(() => [...new Set(people.map(p => p.region).filter(Boolean))].sort(), [people]);

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try { m = new maplibregl.Map({ container: box.current, style: styleUrl || OSM, center: [84.1, 28.2], zoom: 6, attributionControl: { compact: true } }); }
    catch { setMapErr('This browser cannot draw the map (WebGL is off). The lists below still work.'); return; }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', e => { if (String((e as any)?.error?.message || '').match(/style|401|403/i)) setMapErr('The map style could not be loaded. Check NEXT_PUBLIC_MAP_STYLE_URL and the provider key.'); });
    m.on('load', () => {
      m.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', paint: { 'line-color': '#ffffff', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#1C5CAB', 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      ready.current = true;
    });
    map.current = m;
    return () => { ready.current = false; m.remove(); map.current = null; };
  }, [styleUrl]);

  useEffect(() => { const u = new URLSearchParams(window.location.search); if (canTeam && u.get('user')) { setSel(Number(u.get('user'))); if (/^\d{4}-\d{2}-\d{2}$/.test(u.get('day') || '')) setDay(u.get('day')!); } }, [canTeam]);
  useEffect(() => { call('/api/map/customers').then(r => setCust(r.customers)).catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    if (!canTrack && !canTeam) return;
    const load = () => (canTeam ? call('/api/team/today').then(r => setPeople(r.people)) : call('/api/track/latest').then(r => setPeople(r.people.map((p: any) => ({ ...p, last_ping: p.at }))))).catch(() => {});
    load(); const t = setInterval(load, 20000); return () => clearInterval(t);
  }, [canTrack, canTeam]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    custMarkers.current.forEach(x => x.remove());
    custMarkers.current = shown.map(c => {
      const el = document.createElement('div'); el.className = 'mk'; el.style.background = COLORS[c.type] || '#465468'; el.title = c.name;
      return new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<b>${esc(c.name)}</b><br>${esc(c.code)} · ${esc(c.type)}<br>${esc(c.town)}<br>Assigned to: ${esc(c.assigned || 'nobody')}<br><a href="/customers/${c.id}">Open customer</a>`)).addTo(m);
    });
    if (shown.length && !sel) { const b = new maplibregl.LngLatBounds(); shown.forEach(c => b.extend([c.lng, c.lat])); m.fitBounds(b, { padding: 60, maxZoom: 12, duration: 600 }); }
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; if (!m) return;
    peopleMarkers.current.forEach(x => x.remove());
    peopleMarkers.current = team.filter(p => p.lat != null && p.lng != null).map(p => {
      const st = canTeam ? statusOf(p) : 'Visited today', el = document.createElement('div'); el.className = 'mk person'; el.style.background = STATUS[st].color; el.title = `${p.name}: ${st}`;
      el.addEventListener('click', () => { if (canTeam) setSel(p.id); });
      return new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`<b>${esc(p.name)}</b><br>${esc(st)}${p.at_customer ? ': ' + esc(p.at_customer) : ''}<br>Seen ${esc(ago(p.last_ping))}${p.accuracy ? ` · ±${Math.round(p.accuracy)} m` : ''}`)).addTo(m);
    });
  }, [team, canTeam]);

  // One person's day: path, visits in order, long stops.
  const loadTrail = useCallback(() => { if (!sel) { setTrail(null); return; } call(`/api/team/day?user=${sel}&day=${day}`).then(setTrail).catch(e => setErr(e.message)); }, [sel, day]);
  useEffect(() => { loadTrail(); }, [loadTrail]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const draw = () => {
      const src = m.getSource('trail') as maplibregl.GeoJSONSource | undefined; if (!src) return;
      trailMarkers.current.forEach(x => x.remove()); trailMarkers.current = [];
      const pts: [number, number][] = (trail?.points || []).map((p: any) => [p.lng, p.lat]);
      src.setData({ type: 'FeatureCollection', features: pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : [] } as any);
      if (!trail) return;
      const b = new maplibregl.LngLatBounds(); pts.forEach(p => b.extend(p));
      trail.visits.forEach((v: any, i: number) => {
        if (v.in_lat == null) return; const el = document.createElement('div'); el.className = 'mk num'; el.textContent = String(i + 1); el.style.background = v.out_of_fence ? '#D03B3B' : '#0CA30C';
        trailMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([v.in_lng, v.in_lat]).setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`<b>${i + 1}. ${esc(v.customer)}</b><br>${esc(fmtTime(v.in_at))} to ${esc(fmtTime(v.out_at))}<br>${v.out_of_fence ? esc(fmtDist(v.distance_m)) + ' from the customer' : 'At location'}<br>${esc(v.purpose || '')}`)).addTo(m));
        b.extend([v.in_lng, v.in_lat]);
      });
      trail.stops.forEach((st: any) => { const el = document.createElement('div'); el.className = 'mk stop'; el.title = `Stopped ${st.minutes} min`;
        trailMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([st.lng, st.lat]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`Stopped here for ${st.minutes} minutes from ${esc(fmtTime(st.from))}`)).addTo(m)); });
      if (!b.isEmpty()) m.fitBounds(b, { padding: 70, maxZoom: 15, duration: 700 });
    };
    if (ready.current) draw(); else m.once('load', draw);
  }, [trail]);

  const fly = (lng: number, lat: number) => map.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 900 });
  const counts = Object.keys(STATUS).map(k => [k, team.filter(p => statusOf(p) === k).length] as const).filter(x => x[1]);

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <div className="l">
            {canTeam && regions.length > 1 && <label className="user" htmlFor="map-region">Region <select id="map-region" value={region} onChange={e => setRegion(e.target.value)}><option>All</option>{regions.map(r => <option key={r}>{r}</option>)}</select></label>}
            <label className="chk"><input id="map-cust" type="checkbox" checked={showCust} onChange={e => setShowCust(e.target.checked)} /> Customers</label>
            {showCust && <label className="user" htmlFor="map-type">Type <select id="map-type" value={type} onChange={e => setType(e.target.value)}>{['All', ...Object.keys(COLORS)].map(t => <option key={t}>{t}</option>)}</select></label>}
          </div>
          <div className="legend">{canTeam ? counts.map(([k, n]) => <span key={k}><i style={{ background: STATUS[k].color, transform: 'rotate(45deg)' }} />{n} {k.toLowerCase()}</span>)
            : Object.entries(COLORS).map(([k, c]) => <span key={k}><i style={{ background: c, borderRadius: '50%' }} />{k}</span>)}</div>
        </div>
        {err && <div className="errbox" role="alert">{err}</div>}{mapErr && <div className="banner">{mapErr}</div>}
        <div className={trail ? 'mapsplit' : undefined}>
          <div className="mapbox" ref={box} />
          {trail && <div className="daypanel">
            <div className="hd"><div><b>{trail.person.name}</b><br /><span className="code">{trail.person.code} · {trail.person.role}{trail.person.area ? ` · ${trail.person.area}` : ''}</span></div><button className="btn sm" onClick={() => setSel(null)}>Close</button></div>
            <label className="user" htmlFor="map-day">Day <input id="map-day" type="date" value={day} max={nptToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
            <div className="g" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
              <div><div className="lab">Visits</div><div className="num">{trail.visits.length}</div></div><div><div className="lab">GPS distance</div><div className="num">{trail.km} km</div></div><div><div className="lab">Long stops</div><div className="num">{trail.stops.length}</div></div></div>
            {!trail.visits.length ? <p className="sub">No customer visit on this day.</p> : <ol className="tl">
              {trail.visits.map((v: any, i: number) => <li key={v.id} className={v.out_of_fence ? 'flag' : ''}><time>{fmtTime(v.in_at)}</time><div><b>{i + 1}. {v.customer}</b>{v.out_at ? ` · ${Math.max(1, Math.round((Date.parse(v.out_at) - Date.parse(v.in_at)) / 60000))} min` : ' · in progress'}<br />
                <span className="sub">{v.out_of_fence ? `${fmtDist(v.distance_m)} from the saved location · ` : ''}{v.purpose || ''}{v.remarks ? ` · ${v.remarks}` : ''}</span></div></li>)}
            </ol>}
            {trail.points.length < 2 && trail.visits.length > 0 && <p className="sub">Too few location points to draw a path. In the browser app points are saved only while the page is open.</p>}
          </div>}
        </div>
      </section>
      {(canTeam || canTrack) && <section className="card"><div className="hd"><h2>Team</h2><span className="sub">refreshes every 20 seconds{canTeam ? ' · click a person for their day on the map' : ''}</span></div>
        <div className="tbl"><table><thead><tr><th>Person</th><th>Area</th><th>Status</th><th>First visit</th><th className="r">Visits</th><th>Last seen</th><th></th></tr></thead>
          <tbody>{team.map(p => { const st = canTeam ? statusOf(p) : 'Visited today'; return <tr key={p.id} style={sel === p.id ? { background: 'var(--accent-soft)' } : undefined}><td><b>{p.name}</b> <span className="code">{p.code}</span></td><td>{p.area || p.region || '–'}</td>
            <td><span className={`pill ${STATUS[st].pill}`}>{st}{p.at_customer ? `: ${p.at_customer}` : ''}</span></td><td className="num">{canTeam ? fmtTime(p.first_visit_at) : '–'}</td><td className="r num">{p.visits ?? '–'}</td>
            <td>{p.last_ping ? <span className={`pill ${Date.now() - Date.parse(p.last_ping) < 10 * 60000 ? 'good' : 'warn'}`}>{ago(p.last_ping)}</span> : <span className="code">–</span>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{canTeam && <button className="btn sm primary" onClick={() => { setSel(p.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Day on map</button>} {p.lat != null && <button className="btn sm" onClick={() => fly(p.lng, p.lat)}>Find</button>}</td></tr>; })}
            {!team.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '10px 0' }}>Nobody to show yet.</p></td></tr>}</tbody></table></div></section>}
    </>
  );
}
