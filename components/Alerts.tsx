'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';
import { fmtTime } from '@/lib/geo';

const NAMES: Record<string, string> = { geofence: 'Location', coverage: 'Coverage', approval_wait: 'Approval', instrument_expiry: 'Credit', approval_escalation: 'Escalation' };

export default function Alerts({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState(true); const [rows, setRows] = useState<any[] | null>(null); const [rules, setRules] = useState<any[]>([]); const [err, setErr] = useState('');
  const load = useCallback(() => call(`/api/alerts?open=${open ? 1 : 0}`).then(r => { setRows(r.alerts); setErr(''); }).catch(e => setErr(e.message)), [open]);
  useEffect(() => { setRows(null); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { call('/api/alerts/rules').then(r => setRules(r.rules)).catch(() => {}); }, []);
  async function ack(id: number) { try { await call('/api/alerts/ack', { method: 'POST', json: { id } }); toast('Acknowledged and logged under your name.'); load(); } catch (e: any) { toast(e.message); } }
  async function saveRule(r: any, patch: any) {
    try { await call('/api/alerts/rules', { method: 'PUT', json: { key: r.key, ...patch } }); setRules(x => x.map(y => y.key === r.key ? { ...y, ...patch } : y)); toast('Rule saved. It applies from the next check.'); }
    catch (e: any) { toast(e.message); }
  }
  return (
    <>
      <section className="card">
        <div className="toolbar"><div className="l"><h2>{open ? 'Open alerts' : 'Acknowledged, last 14 days'}{rows ? ` (${rows.length})` : ''}</h2></div>
          <div className="r"><button className="btn sm" onClick={() => setOpen(o => !o)}>{open ? 'Show acknowledged' : 'Show open'}</button></div></div>
        {err && <div className="errbox" role="alert">{err}</div>}
        <div className="feed">{(rows || []).map(a => <div key={a.id}><span className={`sev ${a.severity}`} />
          <div className="t"><b>{a.person || 'System'}</b> <span className={`pill ${a.severity === 'crit' ? 'crit' : a.severity === 'warn' ? 'warn' : 'info'}`}>{NAMES[a.rule] || a.rule}</span>{a.area ? <span className="code"> {a.area}</span> : null}<br />{a.message}
            {a.ack_at && <><br /><span className="code">acknowledged by {a.ack_by || '–'} at {fmtTime(a.ack_at)}</span></>}</div>
          <time>{a.day.slice(5)} {fmtTime(a.at)}</time>{open && <button className="btn sm" onClick={() => ack(a.id)}>Acknowledge</button>}</div>)}
          {rows && !rows.length && <p className="sub">{open ? 'Nothing is open. The rules below are checked every minute while anyone has this page open.' : 'Nothing acknowledged in the last 14 days.'}</p>}
          {!rows && !err && <p className="sub">Loading…</p>}</div>
      </section>
      <section className="card"><div className="hd"><h2>Rules</h2><span className="sub">{canManage ? 'changes are saved at once and written to the audit log' : 'only roles with "Change alert rules" can edit'}</span></div>
        <div>{rules.map(r => <div className="rule" key={r.key}><div className="t"><label htmlFor={`ar-${r.key}`}><b>{r.label}</b></label></div>
          {r.threshold != null ? <><input id={`ar-${r.key}`} type="number" min={0} defaultValue={r.threshold} disabled={!canManage} onBlur={e => Number(e.target.value) !== Number(r.threshold) && saveRule(r, { threshold: e.target.value })} /><span className="code" style={{ minWidth: 56 }}>{r.unit}</span></> : <span className="code">on detection</span>}
          <label className="sw"><input type="checkbox" id={`ar-on-${r.key}`} checked={r.enabled} disabled={!canManage} aria-label={`Enable: ${r.label}`} onChange={e => saveRule(r, { enabled: e.target.checked })} /><span /></label></div>)}</div>
      </section>
    </>
  );
}
