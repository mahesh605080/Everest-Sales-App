'use client';
import { useState } from 'react';
import { call, toast } from '@/lib/ui';

export default function SettingsForm({ settings }: { settings: { key: string; value: string; label: string; unit: string }[] }) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(settings.map(s => [s.key, s.value])));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await call('/api/settings', { method: 'PUT', json: v }); toast('Settings saved.'); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={save}>
      <p className="sub">These limits are stored now and used by the field app, approvals and alerts as those phases are switched on.</p>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div>{settings.map(s => <div className="rule" key={s.key}><div className="t"><label htmlFor={`s-${s.key}`}><b>{s.label}</b></label></div>
        <input id={`s-${s.key}`} type="number" min={0} step="any" value={v[s.key]} onChange={e => setV(o => ({ ...o, [s.key]: e.target.value }))} /><span className="code" style={{ minWidth: 56 }}>{s.unit}</span></div>)}</div>
      <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  );
}
