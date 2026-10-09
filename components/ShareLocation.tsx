'use client';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/ui';

const EVERY_MS = 30000;

export default function ShareLocation() {
  const [on, setOn] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [last, setLast] = useState<{ lat: number; lng: number; acc: number; at: Date } | null>(null); const [sent, setSent] = useState(0);
  const watch = useRef<number | null>(null), lastSent = useRef(0);

  function stop() { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); watch.current = null; setOn(false); setMsg('Sharing stopped.'); }
  function start() {
    setErr(''); setMsg('');
    if (!('geolocation' in navigator)) { setErr('This browser cannot read location.'); return; }
    if (!window.isSecureContext) { setErr('Location only works on a secure (https) address.'); return; }
    setOn(true); setMsg('Waiting for the first position…');
    watch.current = navigator.geolocation.watchPosition(async p => {
      const now = Date.now(); if (now - lastSent.current < EVERY_MS) return;
      lastSent.current = now;
      const body = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      try { await call('/api/track/ping', { method: 'POST', json: body }); setLast({ lat: body.lat, lng: body.lng, acc: body.accuracy, at: new Date() }); setSent(n => n + 1); setMsg('Sharing is on.'); setErr(''); }
      catch (e: any) { setErr(e.message + ' Will try again with the next position.'); lastSent.current = 0; }
    }, e => {
      setErr(e.code === e.PERMISSION_DENIED ? 'Location permission was refused. Allow location for this site in the browser settings, then press Start again.' : 'Could not get a position. Move to open sky or switch on GPS.');
      if (e.code === e.PERMISSION_DENIED) stop();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);

  return (
    <section className="card" style={{ maxWidth: 520 }}>
      <div className="hd"><h2>Location sharing</h2>{on ? <span className="pill good">On</span> : <span className="pill">Off</span>}</div>
      <p className="sub">While this is on, your position is sent to the control room about every 30 seconds. Keep this page open and the screen on. Background tracking with the screen off comes with the Android app in Phase 2.</p>
      {err && <div className="errbox" role="alert">{err}</div>}{msg && !err && <div className="okbox">{msg}</div>}
      <div>{on ? <button className="btn danger" onClick={stop}>Stop sharing</button> : <button className="btn primary" onClick={start}>Start sharing</button>}</div>
      {last && <div className="g" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        <div><div className="lab">Last sent</div><div className="num">{last.at.toLocaleTimeString()}</div></div>
        <div><div className="lab">Position</div><div className="num">{last.lat.toFixed(4)}, {last.lng.toFixed(4)}</div></div>
        <div><div className="lab">Accuracy</div><div className="num">±{Math.round(last.acc)} m · {sent} sent</div></div></div>}
    </section>
  );
}
