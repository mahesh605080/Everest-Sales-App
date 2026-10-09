'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '@/lib/ui';

type Cust = { id: number; code: string; name: string; type: string; town: string; lat: number; lng: number; assigned: string | null };
type Person = { id: number; name: string; code: string; role: string; area: string | null; lat: number; lng: number; accuracy: number | null; at: string };
const COLORS: Record<string, string> = { Distributor: '#1C5CAB', Hospital: '#0CA30C', Institution: '#4A3AA7', Retailer: '#EB6834' };
// OpenStreetMap raster tiles: works without a key. For production traffic use a provider style URL (see README).
const OSM: any = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ago = (at: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };

export default function MapView({ canTrack, styleUrl }: { canTrack: boolean; styleUrl: string }) {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  const custMarkers = useRef<maplibregl.Marker[]>([]), peopleMarkers = useRef<maplibregl.Marker[]>([]);
  const [cust, setCust] = useState<Cust[]>([]); const [people, setPeople] = useState<Person[]>([]);
  const [type, setType] = useState('All'); const [err, setErr] = useState(''); const [mapErr, setMapErr] = useState('');
  const shown = useMemo(() => cust.filter(c => type === 'All' || c.type === type), [cust, type]);

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: box.current, style: styleUrl || OSM, center: [84.1, 28.2], zoom: 6, attributionControl: { compact: true } });
    } catch { setMapErr('This browser cannot draw the map (WebGL is off). The lists below still work.'); return; }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('error', e => { if (String((e as any)?.error?.message || '').match(/style|401|403/i)) setMapErr('The map style could not be loaded. Check NEXT_PUBLIC_MAP_STYLE_URL and the provider key.'); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [styleUrl]);

  useEffect(() => { call('/api/map/customers').then(r => setCust(r.customers)).catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    if (!canTrack) return;
    const load = () => call('/api/track/latest').then(r => setPeople(r.people)).catch(() => {});
    load(); const t = setInterval(load, 20000); return () => clearInterval(t);
  }, [canTrack]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    custMarkers.current.forEach(x => x.remove());
    custMarkers.current = shown.map(c => {
      const el = document.createElement('div'); el.className = 'mk'; el.style.background = COLORS[c.type] || '#465468'; el.title = c.name;
      return new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<b>${esc(c.name)}</b><br>${esc(c.code)} · ${esc(c.type)}<br>${esc(c.town)}<br>Assigned to: ${esc(c.assigned || 'nobody')}`)).addTo(m);
    });
    if (shown.length) { const b = new maplibregl.LngLatBounds(); shown.forEach(c => b.extend([c.lng, c.lat])); m.fitBounds(b, { padding: 60, maxZoom: 12, duration: 600 }); }
  }, [shown]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    peopleMarkers.current.forEach(x => x.remove());
    peopleMarkers.current = people.map(p => {
      const el = document.createElement('div'); el.className = 'mk person'; el.title = p.name;
      return new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`<b>${esc(p.name)}</b><br>${esc(p.role)}${p.area ? ' · ' + esc(p.area) : ''}<br>Seen ${esc(ago(p.at))}${p.accuracy ? ` · ±${Math.round(p.accuracy)} m` : ''}`)).addTo(m);
    });
  }, [people]);

  const fly = (lng: number, lat: number) => map.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 900 });

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <div className="l"><label className="user" htmlFor="map-type">Customer type <select id="map-type" value={type} onChange={e => setType(e.target.value)}>{['All', ...Object.keys(COLORS)].map(t => <option key={t}>{t}</option>)}</select></label>
            <span className="sub">{shown.length} customers with a location{canTrack ? ` · ${people.length} ${people.length === 1 ? 'person' : 'people'} seen in the last 12 hours` : ''}</span></div>
          <div className="legend">{Object.entries(COLORS).map(([k, c]) => <span key={k}><i style={{ background: c, borderRadius: '50%' }} />{k}</span>)}{canTrack && <span><i style={{ background: 'var(--accent2)', transform: 'rotate(45deg)' }} />Person</span>}</div>
        </div>
        {err && <div className="errbox" role="alert">{err}</div>}{mapErr && <div className="banner">{mapErr}</div>}
        <div className="mapbox" ref={box} />
      </section>
      {canTrack && <section className="card"><div className="hd"><h2>Team, last known position</h2><span className="sub">refreshes every 20 seconds</span></div>
        <div className="tbl"><table><thead><tr><th>Person</th><th>Role</th><th>Area</th><th>Last seen</th><th className="r">Accuracy</th><th></th></tr></thead>
          <tbody>{people.map(p => <tr key={p.id}><td><b>{p.name}</b> <span className="code">{p.code}</span></td><td>{p.role}</td><td>{p.area || '–'}</td>
            <td><span className={`pill ${Date.now() - Date.parse(p.at) < 10 * 60000 ? 'good' : 'warn'}`}>{ago(p.at)}</span></td><td className="r num">{p.accuracy ? `±${Math.round(p.accuracy)} m` : '–'}</td>
            <td><button className="btn sm" onClick={() => fly(p.lng, p.lat)}>Show on map</button></td></tr>)}
            {!people.length && <tr><td colSpan={6}><p className="sub" style={{ padding: '10px 0' }}>Nobody has shared a location in the last 12 hours. A field user opens "Share my location" on their phone to appear here.</p></td></tr>}</tbody></table></div></section>}
      <section className="card"><div className="hd"><h2>Customers on the map</h2></div>
        <div className="tbl"><table><thead><tr><th>Code</th><th>Customer</th><th>Type</th><th>Town</th><th>Assigned to</th><th></th></tr></thead>
          <tbody>{shown.map(c => <tr key={c.id}><td className="code">{c.code}</td><td><b>{c.name}</b></td><td>{c.type}</td><td>{c.town}</td><td>{c.assigned || '–'}</td><td><button className="btn sm" onClick={() => fly(c.lng, c.lat)}>Show on map</button></td></tr>)}
            {!shown.length && <tr><td colSpan={6}><p className="sub" style={{ padding: '10px 0' }}>No customer has a latitude and longitude yet. Add them in the customer master.</p></td></tr>}</tbody></table></div></section>
    </>
  );
}
