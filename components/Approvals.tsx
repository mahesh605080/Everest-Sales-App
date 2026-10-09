'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';

/** Everything that waits for this person, in one place, oldest first. One tap to decide. */
export default function Approvals() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [rm, setRm] = useState<Record<string, string>>({}); const [busy, setBusy] = useState('');
  const load = useCallback(() => call('/api/approvals').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function act(i: any, yes: boolean) {
    setBusy(i.key); setErr('');
    try { await call(i.url, { method: 'POST', json: { ...(yes ? i.ok : i.no), remarks: rm[i.key] || '' } }); toast(`${i.type} ${yes ? 'approved' : 'rejected'}.`); load(); }
    catch (e: any) { setErr(`${i.title}: ${e.message}`); } finally { setBusy(''); }
  }
  if (!d) return err ? <div className="errbox" role="alert">{err}</div> : <section className="card"><p className="sub">Loading…</p></section>;
  const age = (at: string) => { const h = (Date.now() - new Date(at).getTime()) / 36e5; return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} d`; };
  return <>
    <div className="g kpi">
      <div className="card"><div className="lab">Waiting for me</div><div className="big">{d.items.length}</div><div className="ctx">oldest first</div></div>
      <div className="card"><div className="lab">Value waiting</div><div className="big">{rs(d.value)}</div><div className="ctx">sales held up until decided</div></div>
    </div>
    {err && <div className="errbox" role="alert">{err}</div>}
    {!d.items.length && <section className="card"><p className="sub">Nothing is waiting for you.</p></section>}
    {d.items.map((i: any) => <section className="card" key={i.key} style={i.warn ? { borderColor: 'var(--warn-fill)' } : undefined}>
      <div className="hd"><div><h2>{i.title}</h2><span className="code">{i.type} · {i.sub}</span></div>
        <div className="toolbar"><span className="pill">{age(i.at)}</span>{i.value != null && <b className="num">{rs(i.value)}</b>}<a className="btn sm" href={i.href}>Details</a></div></div>
      {i.note && <p className="sub" style={i.warn ? { color: 'var(--warn)' } : undefined}>{i.note}</p>}
      <div className="toolbar"><div className="l" style={{ flex: 1 }}><input type="text" aria-label={`Remarks for ${i.title}`} placeholder={i.warn ? 'Remarks (needed)' : 'Remarks (needed to reject)'} value={rm[i.key] || ''} onChange={e => setRm(o => ({ ...o, [i.key]: e.target.value }))} style={{ flex: 1, minWidth: 160 }} /></div>
        <div className="r"><button className="btn primary" disabled={busy === i.key} onClick={() => act(i, true)}>{i.okLabel || 'Approve'}</button><button className="btn danger" disabled={busy === i.key} onClick={() => act(i, false)}>Reject</button></div></div>
    </section>)}
  </>;
}
