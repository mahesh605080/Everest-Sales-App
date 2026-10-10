'use client';
import { useState } from 'react';
import { call } from '@/lib/ui';
import NotifySettings from '@/components/NotifySettings';

export default function Profile() {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setOk(false);
    if (next !== again) { setErr('The two new passwords do not match.'); return; }
    setBusy(true);
    try { await call('/api/auth/password', { method: 'POST', json: { current: cur, next } }); setOk(true); setCur(''); setNext(''); setAgain(''); setTimeout(() => { window.location.href = '/dashboard'; }, 900); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (<>
    <form className="card" onSubmit={save} style={{ maxWidth: 460 }}>
      <h2>Change password</h2>
      {err && <div className="errbox" role="alert">{err}</div>}{ok && <div className="okbox">Password changed.</div>}
      <div className="fld"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></div>
      <div className="fld"><label htmlFor="pw-new">New password</label><input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /><small>At least 8 characters.</small></div>
      <div className="fld"><label htmlFor="pw-again">New password again</label><input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} /></div>
      <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
    <NotifySettings />
  </>);
}
