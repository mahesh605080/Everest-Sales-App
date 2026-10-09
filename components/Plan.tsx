'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { call, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';

const monthOf = (off: number) => { const t = nptToday(); const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1 + off, 1)); return d.toISOString().slice(0, 7); };
const label = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const daysIn = (m: string) => { const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
const wd = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const K: Record<string, string> = { Draft: '', Submitted: 'warn', Approved: 'good', 'Sent back': 'crit' };

function Mine() {
  const [month, setMonth] = useState(monthOf(1)); const [d, setD] = useState<any>(null);
  const [items, setItems] = useState<{ day: string; customer_id: number }[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const load = useCallback(() => call(`/api/plan?month=${month}`).then(r => { setD(r); setItems(r.items.map((i: any) => ({ day: i.day, customer_id: i.customer_id }))); setDirty(false); setErr(''); }).catch(e => setErr(e.message)), [month]);
  useEffect(() => { setD(null); load(); }, [load]);
  const cust = useMemo(() => new Map<number, any>((d?.customers || []).map((c: any) => [c.id, c])), [d]);
  const status = d?.plan?.status || 'Draft', editable = status === 'Draft' || status === 'Sent back';
  const add = (day: string, id: number) => { if (!id) return; setItems(x => x.some(i => i.day === day && i.customer_id === id) ? x : [...x, { day, customer_id: id }]); setDirty(true); };
  const del = (day: string, id: number) => { setItems(x => x.filter(i => !(i.day === day && i.customer_id === id))); setDirty(true); };
  async function save(submit: boolean) {
    setBusy(true); setErr('');
    try { await call(submit ? '/api/plan/submit' : '/api/plan', { method: submit ? 'POST' : 'PUT', json: { month, items } }); toast(submit ? 'Plan sent to your manager for approval.' : 'Draft saved.'); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <div className="toolbar"><div className="l"><label className="user" htmlFor="plan-month">Month <select id="plan-month" value={month} onChange={e => setMonth(e.target.value)}>{[-1, 0, 1, 2].map(o => <option key={o} value={monthOf(o)}>{label(monthOf(o))}</option>)}</select></label>
        <span className={`pill ${K[status]}`}>{status}</span>{d?.plan && <span className="sub">{d.plan.planned} planned · {d.plan.done} done · {d.plan.off_plan} visits off plan</span>}</div>
        {editable && <div className="r"><button className="btn" disabled={busy || !dirty} onClick={() => save(false)}>Save draft</button><button className="btn primary" disabled={busy || !items.length} onClick={() => save(true)}>Submit for approval</button></div>}</div>
      {err && <div className="errbox" role="alert">{err}</div>}
      {status === 'Sent back' && d?.plan?.remarks && <div className="banner">Sent back by {d.plan.decided_by_name || 'your manager'}: {d.plan.remarks}</div>}
      {!d && !err && <p className="sub">Loading…</p>}
      {d && !d.customers.length && <p className="sub">No customer is assigned to you yet, so there is nothing to plan.</p>}
      {d && d.customers.length > 0 && <div className="tbl"><table><thead><tr><th style={{ width: 110 }}>Day</th><th>Customers to visit</th>{editable && <th style={{ width: 240 }}>Add</th>}</tr></thead>
        <tbody>{daysIn(month).map(day => { const sat = wd(day) === 'Sat', list = items.filter(i => i.day === day);
          return <tr key={day} style={sat ? { background: 'var(--canvas)' } : undefined}><td className="num">{day.slice(8)} {wd(day)}</td>
            <td>{list.map(i => <span key={i.customer_id} className="pill info" style={{ marginRight: 6, marginBottom: 2 }}>{cust.get(i.customer_id)?.name || 'Customer'}{editable && <button aria-label={`Remove ${cust.get(i.customer_id)?.name}`} onClick={() => del(day, i.customer_id)} style={{ all: 'unset', cursor: 'pointer', marginLeft: 6, fontWeight: 700 }}>×</button>}</span>)}
              {!list.length && <span className="code">{sat ? 'weekly holiday' : '–'}</span>}</td>
            {editable && <td><select aria-label={`Add a customer on ${day}`} value="" onChange={e => add(day, Number(e.target.value))}><option value="">Add customer…</option>{d.customers.filter((c: any) => !list.some(i => i.customer_id === c.id)).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.town ? ` · ${c.town}` : ''}</option>)}</select></td>}</tr>; })}</tbody></table></div>}
    </section>
  );
}

function TeamPlans() {
  const [month, setMonth] = useState(monthOf(1)); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null); const [items, setItems] = useState<any[]>([]); const [remarks, setRemarks] = useState('');
  const load = useCallback(() => call(`/api/plan/team?month=${month}`).then(r => { setRows(r.plans); setErr(''); }).catch(e => setErr(e.message)), [month]);
  useEffect(() => { setRows(null); setOpen(null); load(); }, [load]);
  async function show(id: number) { if (open === id) { setOpen(null); return; } setRemarks(''); setItems([]); setOpen(id); try { setItems((await call(`/api/plan?id=${id}`)).items); } catch (e: any) { setErr(e.message); } }
  async function decide(id: number, action: string) { try { await call('/api/plan/decide', { method: 'POST', json: { id, action, remarks } }); toast(action === 'approve' ? 'Plan approved.' : 'Plan sent back for correction.'); setOpen(null); load(); } catch (e: any) { setErr(e.message); } }
  return (
    <section className="card">
      <div className="toolbar"><div className="l"><h2>Team plans</h2><label className="user" htmlFor="tplan-month">Month <select id="tplan-month" value={month} onChange={e => setMonth(e.target.value)}>{[-1, 0, 1, 2].map(o => <option key={o} value={monthOf(o)}>{label(monthOf(o))}</option>)}</select></label></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="tbl"><table><thead><tr><th>Person</th><th>Area</th><th>Status</th><th className="r">Planned</th><th className="r">Done</th><th>Completion</th><th className="r">Off plan</th><th></th></tr></thead>
        <tbody>{(rows || []).map(p => <Fragment key={p.id}><tr><td><b>{p.person}</b> <span className="code">{p.person_code}</span></td><td>{p.area || '–'}</td><td><span className={`pill ${K[p.status]}`}>{p.status}</span></td>
          <td className="r num">{p.planned}</td><td className="r num">{p.done}</td><td><div className="meter"><i style={{ width: `${p.planned ? Math.min(100, p.done / p.planned * 100) : 0}%` }} /></div></td><td className="r num">{p.off_plan}</td>
          <td><button className="btn sm" onClick={() => show(p.id)}>{open === p.id ? 'Close' : 'Open'}</button></td></tr>
          {open === p.id && <tr><td colSpan={8} style={{ background: 'var(--canvas)', padding: 12 }}>
            <div className="tbl" style={{ maxHeight: 300, overflowY: 'auto' }}><table><thead><tr><th>Day</th><th>Customer</th><th>Town</th><th>Visited</th></tr></thead><tbody>{items.map((i, k) => <tr key={k}><td className="num">{i.day.slice(8)} {wd(i.day)}</td><td>{i.customer}</td><td>{i.town || '–'}</td><td>{i.done ? <span className="pill good">Done</span> : <span className="code">–</span>}</td></tr>)}</tbody></table></div>
            {p.status === 'Submitted' && <div className="toolbar" style={{ marginTop: 10 }}><div className="l" style={{ flex: 1 }}><input type="text" id={`plan-rm-${p.id}`} aria-label="Remarks" placeholder="Remarks (needed to send back)" value={remarks} onChange={e => setRemarks(e.target.value)} style={{ flex: 1, minWidth: 200 }} /></div>
              <div className="r"><button className="btn primary" onClick={() => decide(p.id, 'approve')}>Approve</button><button className="btn danger" onClick={() => decide(p.id, 'back')}>Send back</button></div></div>}</td></tr>}</Fragment>)}
          {rows && !rows.length && <tr><td colSpan={8}><p className="sub" style={{ padding: '12px 0' }}>No plan has been submitted for {label(month)} yet.</p></td></tr>}</tbody></table></div>
    </section>
  );
}

export default function Plan({ canUse, canApprove }: { canUse: boolean; canApprove: boolean }) {
  return <>{canApprove && <TeamPlans />}{canUse && <Mine />}</>;
}
