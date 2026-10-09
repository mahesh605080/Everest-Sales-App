'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { fmtDist, fmtTime, getPos, Pos } from '@/lib/geo';
import Opportunities from './Opportunities';

export default function Field() {
  const [d, setD] = useState<any>(null); const [pos, setPos] = useState<Pos | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const [proj, setProj] = useState(''); const [actual, setActual] = useState('');
  const [v, setV] = useState({ purpose: '', person_met: '', remarks: '', next_visit: '' });
  const lastPing = useRef(0);
  const [selfie, setSelfie] = useState('');
  // Shrinks the camera photo to a small JPEG so it uploads quickly on mobile data.
  function onSelfie(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); setSelfie(c.toDataURL('image/jpeg', 0.7)); URL.revokeObjectURL(url);
    };
    img.onerror = () => { setErr('That file is not a photo. Take the selfie again.'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  const load = useCallback(async (p?: Pos | null) => {
    try { setD(await call(`/api/field/today${p ? `?lat=${p.lat}&lng=${p.lng}` : ''}`)); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(null); getPos().then(p => { setPos(p); load(p); }).catch(() => {}); }, [load]);

  // While the day is open and this page is on screen, keep the control room's map up to date.
  const dayOpen = !!d?.attendance && !d.attendance.out_at;
  useEffect(() => {
    if (!dayOpen || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(p => {
      const np = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; setPos(np);
      if (Date.now() - lastPing.current < 60000) return; lastPing.current = Date.now();
      call('/api/track/ping', { method: 'POST', json: np }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [dayOpen]);

  async function act(name: string, url: string, body: any, done: (r: any) => string, needPos = true) {
    setErr(''); setBusy(name);
    try {
      let p: Pos | null = null;
      if (needPos) { p = await getPos(); setPos(p); if (p.accuracy > 100) toast(`GPS is weak (±${Math.round(p.accuracy)} m). Saved anyway; move to open sky for a better fix.`); }
      const r = await call(url, { method: 'POST', json: { ...body, ...(p || pos || {}) } });
      toast(done(r)); await load(p || pos);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  if (!d) return <section className="card">{err ? <div className="errbox" role="alert">{err}</div> : <p className="sub">Loading your day…</p>}</section>;
  const a = d.attendance, open = d.open, closed = !!a?.out_at;

  return (
    <div className="g" style={{ maxWidth: 760 }}>
      {err && <div className="errbox" role="alert">{err}</div>}
      <section className="card">
        <div className="hd"><h2>Attendance</h2>{closed ? <span className="pill">Day closed</span> : a ? <span className="pill good">On duty since {fmtTime(a.in_at)}</span> : <span className="pill warn">Not checked in</span>}</div>
        {!a && <>
          <div className="fld"><label htmlFor="proj">Today's sales projection (Rs)</label><input id="proj" type="number" min={0} inputMode="numeric" value={proj} onChange={e => setProj(e.target.value)} placeholder="0" /></div>
          {d.selfie && <div className="fld"><label htmlFor="selfie">Selfie *</label>
            <div className="toolbar"><div className="l"><input id="selfie" type="file" accept="image/*" capture="user" onChange={onSelfie} />{selfie && <img src={selfie} alt="Your selfie" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />}</div></div></div>}
          <div><button className="btn primary" disabled={!!busy} style={{ padding: '11px 18px' }} onClick={() => { if (d.selfie && !selfie) { setErr('Take a selfie before starting the day.'); return; } act('in', '/api/field/checkin', { projection: proj === '' ? 0 : Number(proj), photo: selfie || undefined }, () => 'Day started. Time and location saved.'); }}>{busy === 'in' ? 'Getting location…' : 'Start day'}</button></div>
          <p className="sub">Your location is saved at check-in, at each visit and at check-out, and shared with the control room while this page is open during duty hours.</p></>}
        {a && <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
          <div><div className="lab">Check-in</div><div className="num">{fmtTime(a.in_at)} {a.late && <span className="pill warn">Late</span>}</div></div>
          <div><div className="lab">Projection</div><div className="num">{rs(a.projection)}</div></div>
          <div><div className="lab">Visits today</div><div className="num">{d.visits.length}</div></div>
          {closed && <><div><div className="lab">Check-out</div><div className="num">{fmtTime(a.out_at)}</div></div><div><div className="lab">Actual sales</div><div className="num">{rs(a.actual)}</div></div></>}</div>}
        {a && !closed && !open && <div className="toolbar"><div className="l"><div className="fld"><label htmlFor="actual">Actual sales today (Rs)</label><input id="actual" type="number" min={0} inputMode="numeric" value={actual} onChange={e => setActual(e.target.value)} /></div></div>
          <div className="r"><button className="btn danger" disabled={!!busy} onClick={() => act('out', '/api/field/checkout', { actual }, () => 'Day ended. Location sharing is off.')}>{busy === 'out' ? 'Getting location…' : 'End day'}</button></div></div>}
      </section>

      {open && <section className="card" style={{ borderColor: 'var(--accent2)' }}>
        <div className="hd"><div><h2>Visit in progress: {open.customer}</h2><span className="code">in at {fmtTime(open.in_at)} · {fmtDist(open.distance_m)} from saved location</span></div>
          {open.out_of_fence ? <span className="pill crit">Outside {d.radius} m geo-fence</span> : <span className="pill good">At location</span>}</div>
        <div className="form">
          <div className="fld"><label htmlFor="v-purpose">Purpose *</label><select id="v-purpose" value={v.purpose} onChange={e => setV({ ...v, purpose: e.target.value })}><option value="">Select…</option>{d.purposes.map((p: string) => <option key={p}>{p}</option>)}</select></div>
          <div className="fld"><label htmlFor="v-person">Person met</label><input id="v-person" type="text" value={v.person_met} onChange={e => setV({ ...v, person_met: e.target.value })} /></div>
          <div className="fld wide"><label htmlFor="v-remarks">Remarks * (10 characters or more)</label><input id="v-remarks" type="text" value={v.remarks} onChange={e => setV({ ...v, remarks: e.target.value })} /></div>
          <div className="fld"><label htmlFor="v-next">Next visit date</label><input id="v-next" type="date" value={v.next_visit} onChange={e => setV({ ...v, next_visit: e.target.value })} /></div>
        </div>
        <div className="toolbar"><div className="l"><a className="btn" href={`/orders?customer=${open.customer_id}`}>Take order</a><a className="btn" href={`/orders?customer=${open.customer_id}&repeat=1`}>Repeat last order</a><a className="btn" href={`/booklets?customer=${open.customer_id}`}>Ask special rate</a><a className="btn" href="/r/collections">Record collection</a></div></div>
        <div><button className="btn primary" disabled={!!busy} onClick={() => act('vend', '/api/field/visit/end', v, () => { setV({ purpose: '', person_met: '', remarks: '', next_visit: '' }); return 'Visit saved.'; }, false)}>{busy === 'vend' ? 'Saving…' : 'Check out of visit'}</button></div>
      </section>}

      <Opportunities canOrder compact />
      <section className="card">
        <div className="hd"><h2>My customers</h2><span className="sub">{pos ? `sorted by distance · GPS ±${Math.round(pos.accuracy)} m` : 'allow location to sort by distance'}</span></div>
        <div className="feed">{d.customers.map((c: any) => <div key={c.id} style={{ alignItems: 'center' }}>
          <div className="t"><a href={`/customers/${c.id}`}><b>{c.name}</b></a>{c.planned && <span className="pill info" style={{ marginLeft: 6 }}>Planned today</span>}<br /><span className="code">{c.code} · {c.type} · {c.town || '–'} · last visit {c.last_visit ? new Date(c.last_visit).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'never'}</span></div>
          <span className={`pill ${c.distance_m == null ? '' : c.distance_m <= d.radius ? 'good' : 'warn'}`}>{c.lat == null ? 'location not set' : fmtDist(c.distance_m)}</span>
          {a && !closed && !open && <button className="btn sm primary" disabled={!!busy} onClick={() => act('v' + c.id, '/api/field/visit/start', { customer_id: c.id },
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
