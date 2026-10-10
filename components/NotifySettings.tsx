'use client';
import { useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';
import { disablePush, enablePush, pushState, PushState } from '@/lib/push';

const LABEL: Record<string, string> = { general: 'General', orders: 'Orders and credit', approvals: 'Approvals', collections: 'Collections', stock: 'Stock and expiry', chat: 'Chat', announcements: 'Announcements' };
const WHY: Record<PushState, string> = {
  on: 'This browser shows notifications even when the app is closed.',
  off: 'Switch on to get notifications on this browser even when the app is closed.',
  blocked: 'Notifications are blocked for this site in the browser. Allow them in the site settings (the lock icon next to the address), then come back.',
  unsupported: 'This browser cannot receive push notifications. Notifications still appear under the bell while the app is open.',
  'needs-install': 'On an iPhone, first add this site to the Home Screen (Share, then "Add to Home Screen"), open it from there, and switch notifications on.',
  'off-on-server': 'Push is not set up on the server yet. Notifications still appear under the bell while the app is open.',
};

export default function NotifySettings() {
  const [state, setState] = useState<PushState | null>(null); const [p, setP] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); call('/api/v1/notifications/preferences').then(setP).catch(e => setErr(e.message)); }, []);
  async function toggle() { setBusy(true); setErr(''); try { if (state === 'on') { await disablePush(); setState('off'); toast('Notifications switched off on this browser.'); } else { const s = await enablePush(); setState(s); if (s === 'on') toast('Notifications switched on.'); } } catch (e: any) { setErr(e.message || 'Could not switch notifications on.'); } finally { setBusy(false); } }
  async function save(next: any) { setP(next); setErr(''); try { setP(await call('/api/v1/notifications/preferences', { method: 'PUT', json: { push_enabled: next.push_enabled, muted_categories: next.muted_categories, quiet_from: next.quiet_from || null, quiet_to: next.quiet_to || null } })); toast('Saved.'); } catch (e: any) { setErr(e.message); } }
  return (
    <section className="card" style={{ maxWidth: 460 }}>
      <h2>Notifications</h2>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="hd"><div><b>On this browser</b><br /><span className="sub">{state ? WHY[state] : 'Checking…'}</span></div>
        {(state === 'on' || state === 'off') && <button className={`btn ${state === 'on' ? '' : 'primary'}`} disabled={busy} onClick={toggle}>{busy ? 'Wait…' : state === 'on' ? 'Switch off' : 'Switch on'}</button>}</div>
      {p && <>
        <div className="fld"><label className="chk"><input type="checkbox" checked={p.push_enabled} onChange={e => save({ ...p, push_enabled: e.target.checked })} /> Send push to my devices</label><small>When off, everything still arrives under the bell.</small></div>
        <div className="fld"><span className="lab" style={{ fontSize: 12, fontWeight: 600 }}>Do not tell me about</span>
          {p.categories.map((c: string) => <label key={c} className="chk"><input type="checkbox" checked={p.muted_categories.includes(c)} onChange={e => save({ ...p, muted_categories: e.target.checked ? [...p.muted_categories, c] : p.muted_categories.filter((x: string) => x !== c) })} /> {LABEL[c] || c}</label>)}</div>
        <div className="fld"><label htmlFor="q-from">Quiet hours (Nepal time)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><input id="q-from" style={{ width: 130 }} type="time" aria-label="Quiet from" value={p.quiet_from || ''} onChange={e => setP({ ...p, quiet_from: e.target.value })} /><span>to</span><input type="time" style={{ width: 130 }} aria-label="Quiet to" value={p.quiet_to || ''} onChange={e => setP({ ...p, quiet_to: e.target.value })} />
            <button className="btn sm" onClick={() => save(p)}>Save</button>{(p.quiet_from || p.quiet_to) && <button className="btn sm" onClick={() => save({ ...p, quiet_from: null, quiet_to: null })}>Clear</button>}</div>
          <small>Push waits until quiet hours end. Urgent ones still come through.</small></div>
      </>}
    </section>
  );
}
