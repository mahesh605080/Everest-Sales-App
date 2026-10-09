'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';

const TONE: Record<string, string> = { 'Near-expiry lot': 'warn', 'Approved rate': 'good', 'Running low': 'crit', 'Stopped ordering': 'serious', 'Collect payment': 'crit', 'Not buying yet': 'info' };
const CLS: Record<string, string> = { A: 'good', B: 'info', C: '' };

/** One ranked list of what to do today. Each row can be answered, so the list learns what was tried. */
export default function Actions({ canOrder, compact = false }: { canOrder: boolean; compact?: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [ask, setAsk] = useState<string | null>(null); const [why, setWhy] = useState(''); const [more, setMore] = useState(false);
  const load = useCallback(() => call('/api/sales/actions').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function answer(key: string, outcome: string, reason?: string) {
    try { const r = await call('/api/sales/actions', { method: 'POST', json: { key, outcome, reason } }); toast(outcome === 'done' ? 'Marked done.' : `Hidden for ${r.hidden_days} days.`); setAsk(null); setWhy(''); load(); } catch (e: any) { setErr(e.message); }
  }
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return compact ? null : <section className="card"><p className="sub">Working out today's list…</p></section>;
  if (compact && !d.actions.length) return null;
  const list = d.actions.slice(0, compact ? 5 : more ? 60 : 15);
  return <section className="card">
    <div className="hd"><div><h2>{compact ? 'Do these first today' : 'Action list'}</h2><span className="sub">{d.total} {d.total === 1 ? 'action' : 'actions'} worth about {rs(d.value)} · best first: value × how soon the chance is gone</span></div>
      {compact && <a className="btn sm" href="/opportunities">See all</a>}</div>
    {!d.actions.length && <p className="sub">Nothing is waiting. Every chance has been taken or answered.</p>}
    <div className="feed">{list.map((a: any, i: number) => <div key={a.key} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="t" style={{ minWidth: 200 }}><span className="code">{i + 1}.</span> <a href={`/customers/${a.customer_id}`}><b>{a.customer}</b></a> <span className={`pill ${CLS[a.cls]}`}>{a.cls}</span> <span className={`pill ${TONE[a.kind] || 'info'}`}>{a.kind}</span> <b className="num">{rs(a.value)}</b><br /><span className="sub">{a.text}</span>
        {ask === a.key && <div className="toolbar" style={{ marginTop: 8 }}><div className="l" style={{ flex: 1 }}><select aria-label="Reason" value={why} onChange={e => setWhy(e.target.value)}><option value="">Why not?</option>{d.reasons.map((r: string) => <option key={r}>{r}</option>)}</select>
          <button className="btn sm primary" disabled={!why} onClick={() => answer(a.key, 'no', why)}>Save</button><button className="btn sm" onClick={() => { setAsk(null); setWhy(''); }}>Cancel</button></div></div>}</div>
      <div className="toolbar" style={{ gap: 6 }}>{(canOrder || a.cta !== 'Create order') && <a className="btn sm primary" href={a.href}>{a.cta}</a>}
        {canOrder && <><button className="btn sm" title="Done or already handled" onClick={() => answer(a.key, 'done')}>Done</button><button className="btn sm" title="Ask again in 3 days" onClick={() => answer(a.key, 'later')}>Later</button><button className="btn sm" onClick={() => { setAsk(a.key); setWhy(''); }}>Not interested</button></>}</div>
    </div>)}</div>
    {!compact && d.actions.length > 15 && <div><button className="btn sm" onClick={() => setMore(!more)}>{more ? 'Show top 15' : `Show all ${d.actions.length}`}</button></div>}
  </section>;
}

export function Classes() {
  const [d, setD] = useState<any>(null); const [open, setOpen] = useState(false);
  useEffect(() => { call('/api/sales/actions?view=classes').then(setD).catch(() => {}); }, []);
  if (!d || !d.customers.length) return null;
  const tot = d.summary.reduce((a: number, x: any) => a + x.value, 0);
  return <section className="card"><div className="hd"><div><h2>Customers by class</h2><span className="sub">A = the customers who bring the first 80% of 12-month sales, B = the next 15%, C = the rest</span></div><button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide customers' : 'Show customers'}</button></div>
    <div className="g kpi">{d.summary.map((x: any) => <div className="card" key={x.cls}><div className="lab">Class {x.cls} · visit every {x.norm_days} days</div><div className="big">{x.customers}</div>
      <div className="ctx">{tot > 0 ? `${Math.round(x.value / tot * 100)}% of sales` : 'no sales yet'} · <span style={{ color: x.overdue ? 'var(--crit)' : undefined }}>{x.overdue} visit{x.overdue === 1 ? '' : 's'} overdue</span></div></div>)}</div>
    {open && <div className="tbl"><table><thead><tr><th>Customer</th><th>Class</th><th>Sales officer</th><th className="r">Sales, 12 months</th><th>Last visit</th></tr></thead>
      <tbody>{d.customers.map((c: any) => <tr key={c.id}><td><a href={`/customers/${c.id}`}><b>{c.name}</b></a><br /><span className="code">{c.type} · {c.town || '–'}</span></td><td><span className={`pill ${CLS[c.cls]}`}>{c.cls}</span></td><td>{c.person || '–'}</td><td className="r num">{rs(c.value)}</td>
        <td>{c.last_visit ? <span className="num">{c.last_visit}</span> : <span className="code">never</span>} {c.overdue && <span className="pill crit">overdue</span>}</td></tr>)}</tbody></table></div>}
  </section>;
}

export function Feedback() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call('/api/sales/actions?view=feedback').then(setD).catch(() => {}); }, []);
  if (!d || !(d.counts.done + d.counts.later + d.counts.no)) return null;
  const mx = Math.max(1, ...d.reasons.map((r: any) => r.n));
  return <section className="card"><div className="hd"><div><h2>What the field answered, last 30 days</h2><span className="sub">{d.counts.done} done · {d.counts.later} later · {d.counts.no} not interested</span></div></div>
    {d.reasons.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{d.reasons.map((r: any) => <div key={r.reason}><div className="hd"><span>{r.reason}</span><span className="num">{r.n}</span></div>
      <div style={{ height: 10, background: 'var(--sunk)', borderRadius: 4 }}><div style={{ height: '100%', width: `${r.n / mx * 100}%`, borderRadius: '0 4px 4px 0', background: 'var(--accent2)' }} /></div></div>)}</div>}
    {d.latest.length > 0 && <div className="tbl"><table><thead><tr><th>Customer</th><th>Reason</th><th>Sales officer</th></tr></thead>
      <tbody>{d.latest.slice(0, 10).map((f: any, i: number) => <tr key={i}><td><a href={`/customers/${f.customer_id}`}>{f.customer}</a></td><td>{f.reason}</td><td>{f.person}</td></tr>)}</tbody></table></div>}
  </section>;
}
