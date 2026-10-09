'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, toast } from '@/lib/ui';
import { fmtDist, fmtTime, getPos, Pos } from '@/lib/geo';
import Opportunities from './Opportunities';

export default function Field() {
  const [d, setD] = useState<any>(null); const [pos, setPos] = useState<Pos | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [v, setV] = useState({ purpose: '', person_met: '', remarks: '', next_visit: '' });
  const lastPing = useRef(0);

  const load = useCallback(async (p?: Pos | null) => {
    try { setD(await call(`/api/field/today${p ? `?lat=${p.lat}&lng=${p.lng}` : ''}`)); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(null); getPos().then(p => { setPos(p); load(p); }).catch(() => {}); }, [load]);

  // While a visit is open and this page is on screen, keep the manager's map up to date.
  const visitOpen = !!d?.open;
  useEffect(() => {
    if (!visitOpen || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(p => {
      const np = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; setPos(np);
      if (Date.now() - lastPing.current < 60000) return; lastPing.current = Date.now();
      call('/api/track/ping', { method: 'POST', json: np }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [visitOpen]);

  async function act(name: string, url: string, body: any, done: (r: any) => string, needPos = true) {
    setErr(''); setBusy(name);
    try {
      let p: Pos | null = null;
      if (needPos) { p = await getPos(); setPos(p); if (p.accuracy > 100) toast(`GPS is weak (±${Math.round(p.accuracy)} m). Saved anyway; move to open sky for a better fix.`); }
      const r = await call(url, { method: 'POST', json: { ...body, ...(p || pos || {}) } });
      toast(done(r)); await load(p || pos);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  if (!d) return <section className="card">{err ? <div className="errbox" role="alert">{err}</div> : <p className="sub">Loading your customers…</p>}</section>;
  const open = d.open;

  return (
    <div className="g" style={{ maxWidth: 760 }}>
      {err && <div className="errbox" role="alert">{err}</div>}

      {open && <section className="card" style={{ borderColor: 'var(--accent2)' }}>
        <div className="hd"><div><h2>Visit in progress: {open.customer}</h2><span className="code">in at {fmtTime(open.in_at)} · {fmtDist(open.distance_m)} from saved location</span></div>
          {open.out_of_fence ? <span className="pill crit">Outside {d.radius} m geo-fence</span> : <span className="pill good">At location</span>}</div>
        <div className="toolbar"><div className="l"><a className="btn primary" href={`/orders?customer=${open.customer_id}`}>Take order</a><a className="btn" href={`/orders?customer=${open.customer_id}&repeat=1`}>Repeat last order</a><a className="btn" href={`/booklets?customer=${open.customer_id}`}>Ask special rate</a><a className="btn" href="/r/collections">Record collection</a></div></div>
        <div className="form">
          <div className="fld"><label htmlFor="v-purpose">Purpose *</label><select id="v-purpose" value={v.purpose} onChange={e => setV({ ...v, purpose: e.target.value })}><option value="">Select…</option>{d.purposes.map((p: string) => <option key={p}>{p}</option>)}</select></div>
          <div className="fld"><label htmlFor="v-person">Person met</label><input id="v-person" type="text" value={v.person_met} onChange={e => setV({ ...v, person_met: e.target.value })} /></div>
          <div className="fld wide"><label htmlFor="v-remarks">Remarks * (10 characters or more)</label><input id="v-remarks" type="text" value={v.remarks} onChange={e => setV({ ...v, remarks: e.target.value })} /></div>
          <div className="fld"><label htmlFor="v-next">Next visit date</label><input id="v-next" type="date" value={v.next_visit} onChange={e => setV({ ...v, next_visit: e.target.value })} /></div>
        </div>
        <div><button className="btn" disabled={!!busy} onClick={() => act('vend', '/api/field/visit/end', v, () => { setV({ purpose: '', person_met: '', remarks: '', next_visit: '' }); return 'Visit saved.'; }, false)}>{busy === 'vend' ? 'Saving…' : 'Check out of visit'}</button></div>
      </section>}

      <Opportunities canOrder compact />

      <section className="card">
        <div className="hd"><h2>My customers</h2><span className="sub">{pos ? `sorted by distance · GPS ±${Math.round(pos.accuracy)} m` : 'allow location to sort by distance'}</span></div>
        <div className="feed">{d.customers.map((c: any) => <div key={c.id} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="t" style={{ minWidth: 180 }}><a href={`/customers/${c.id}`}><b>{c.name}</b></a>{c.planned && <span className="pill info" style={{ marginLeft: 6 }}>Planned today</span>}<br /><span className="code">{c.code} · {c.type} · {c.town || '–'} · last visit {c.last_visit ? new Date(c.last_visit).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'never'}</span></div>
          <span className={`pill ${c.distance_m == null ? '' : c.distance_m <= d.radius ? 'good' : 'warn'}`}>{c.lat == null ? 'location not set' : fmtDist(c.distance_m)}</span>
          <a className="btn sm" href={`/orders?customer=${c.id}`}>Order</a>
          {!open && <button className="btn sm primary" disabled={!!busy} onClick={() => act('v' + c.id, '/api/field/visit/start', { customer_id: c.id },
            r => r.visit.captured ? 'Checked in. This is now the customer\'s saved location.' : r.visit.out_of_fence ? `Checked in, flagged: ${r.visit.distance_m} m is outside the ${r.visit.radius} m geo-fence.` : 'Checked in at the customer.')}>{busy === 'v' + c.id ? 'Locating…' : 'Check in'}</button>}
        </div>)}
          {!d.customers.length && <p className="sub">No customer is assigned to you yet. Ask your manager or the Admin.</p>}</div>
      </section>

      <section className="card"><h2>Today's visits</h2>
        {d.visits.length ? <div className="tbl"><table><thead><tr><th>Customer</th><th>In</th><th>Out</th><th>Purpose</th><th>Remarks</th><th>Location</th></tr></thead>
          <tbody>{d.visits.map((x: any) => <tr key={x.id}><td><b>{x.customer}</b></td><td className="num">{fmtTime(x.in_at)}</td><td className="num">{fmtTime(x.out_at)}</td><td>{x.purpose || '–'}</td><td>{x.remarks || '–'}</td>
            <td>{x.out_of_fence ? <span className="pill crit">{fmtDist(x.distance_m)} away</span> : <span className="pill good">At location</span>}</td></tr>)}</tbody></table></div>
          : <p className="sub">No visits yet today.</p>}
      </section>
    </div>
  );
}
