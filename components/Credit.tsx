'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';
import { CreditBox, Status, VarPill, when } from './SalesBits';
import { BookletDetail } from './Booklets';
import { OrderCard } from './Orders';

function OrderList({ box, empty }: { box: string; empty: string }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<number | null>(null); const [day, setDay] = useState(nptToday());
  const load = useCallback(() => call(`/api/orders?box=${box}`).then(r => { setRows(r.orders); setErr(''); }).catch(e => setErr(e.message)), [box]);
  useEffect(() => { load(); }, [load]);
  return <>
    {box === 'approved' && <section className="card"><div className="toolbar"><div className="l"><h2>Daily export for manual entry</h2><label className="user" htmlFor="exp-day">Approved on <input id="exp-day" type="date" value={day} max={nptToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label></div>
      <div className="r"><a className="btn primary" href={`/api/orders/export?day=${day}`}>Download Excel</a></div></div><p className="sub">One row per order line, for keying into the accounting software. Then mark each order dispatched with its invoice number.</p></section>}
    {err && <div className="errbox" role="alert">{err}</div>}
    {(rows || []).map(o => <OrderCard key={o.id} o={o} open={open === o.id} toggle={() => setOpen(open === o.id ? null : o.id)} onDone={() => { setOpen(null); load(); }} />)}
    {rows && !rows.length && <section className="card"><p className="sub">{empty}</p></section>}
  </>;
}

function Customers() {
  const [rows, setRows] = useState<any[] | null>(null); const [search, setSearch] = useState(''); const [sel, setSel] = useState<number | null>(null); const [c, setC] = useState<any>(null);
  const [limit, setLimit] = useState(''); const [err, setErr] = useState('');
  const [f, setF] = useState({ type: 'Bank Guarantee', bank: '', ref_no: '', amount: '', issue_date: '', expiry_date: '' });
  const load = useCallback(() => call(`/api/credit?q=${encodeURIComponent(search)}`).then(r => setRows(r.customers)).catch(e => setErr(e.message)), [search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const pick = useCallback((id: number) => { setSel(id); setC(null); setErr(''); call(`/api/credit?customer=${id}`).then(r => { setC(r.credit); setLimit(String(r.credit.credit_limit)); }).catch(e => setErr(e.message)); }, []);
  async function run(fn: () => Promise<any>, msg: string) { setErr(''); try { await fn(); toast(msg); if (sel) pick(sel); load(); } catch (e: any) { setErr(e.message); } }
  return <>
    <section className="card"><div className="toolbar"><div className="l"><input id="cr-search" className="search" type="text" aria-label="Search customers" placeholder="Search customers" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="r"><span className="sub">sorted by how much of the limit is used</span></div></div>
      <div className="tbl"><table><thead><tr><th>Customer</th><th>Assigned to</th><th className="r">Limit</th><th className="r">Outstanding</th><th>Used</th><th>Aging</th><th className="r">90+ days</th><th className="r">Available</th><th>Instruments</th></tr></thead>
        <tbody>{(rows || []).map(r => { const used = r.credit_limit ? r.outstanding / r.credit_limit * 100 : (r.outstanding ? 999 : 0), av = r.credit_limit - r.outstanding - r.committed;
          return <tr key={r.id} onClick={() => pick(r.id)} style={{ cursor: 'pointer', background: sel === r.id ? 'var(--accent-soft)' : undefined }}><td><b>{r.name}</b><br /><span className="code">{r.code} · {r.town || '–'}</span></td><td>{r.assigned || '–'}</td>
            <td className="r num">{rs(r.credit_limit)}</td><td className="r num">{rs(r.outstanding)}</td><td><span className={`pill ${used > 90 ? 'crit' : used > 80 ? 'warn' : 'good'}`}>{used > 900 ? 'no limit' : used.toFixed(0) + '%'}</span></td>
            <td>{r.outstanding > 0 ? <div className="aging">{[r.b0, r.b1, r.b2, r.b3].map((v: number, i: number) => v > 0 ? <i key={i} className={`a${i}`} style={{ flex: v }} /> : null)}</div> : <span className="code">–</span>}</td>
            <td className="r num">{r.b3 ? rs(r.b3) : '–'}</td><td className="r num" style={av < 0 ? { color: 'var(--crit)' } : undefined}>{rs(av)}</td><td>{r.instruments ? <span className="code">{r.instruments} · next {r.next_expiry || '–'}</span> : <span className="code">none</span>}</td></tr>; })}</tbody></table></div></section>
    {err && <div className="errbox" role="alert">{err}</div>}
    {sel && c && <section className="card enter"><div className="hd"><div><h2>{c.name}</h2><span className="code">{c.code} · {c.town || '–'}</span></div><div className="toolbar"><a className="btn sm" href={`/customers/${c.id}`}>Full customer page</a><button className="btn sm" onClick={() => setSel(null)}>Close</button></div></div>
      <CreditBox c={c} />
      <div className="toolbar"><div className="l"><div className="fld"><label htmlFor="cr-limit">Credit limit (Rs)</label><input id="cr-limit" type="number" min={0} step={50000} value={limit} onChange={e => setLimit(e.target.value)} /></div></div>
        <div className="r"><button className="btn primary" disabled={Number(limit) === c.credit_limit} onClick={() => run(() => call('/api/credit', { method: 'PUT', json: { customer_id: c.id, limit: Number(limit) } }), 'Credit limit saved. The old value is in the audit log.')}>Save limit</button></div></div>
      <h2>Financial instruments</h2>
      <div className="tbl"><table><thead><tr><th>Type</th><th>Bank</th><th>Number</th><th className="r">Amount</th><th>Issued</th><th>Expiry / cheque date</th><th>Status</th></tr></thead>
        <tbody>{c.instruments.map((i: any) => <tr key={i.id}><td><b>{i.type}</b></td><td>{i.bank || '–'}</td><td className="code">{i.ref_no || '–'}</td><td className="r num">{rs(i.amount)}</td><td className="num">{i.issue_date || '–'}</td>
          <td className="num">{i.expiry_date || '–'} {i.status === 'Active' && (i.expired ? <span className="pill crit">Expired</span> : i.expiring ? <span className="pill warn">Soon</span> : null)}</td>
          <td><select aria-label={`Status of ${i.type} ${i.ref_no || ''}`} value={i.status} onChange={e => run(() => call('/api/credit', { method: 'POST', json: { id: i.id, status: e.target.value } }), 'Instrument status saved.')}>{['Active', 'Deposited', 'Cleared', 'Bounced', 'Released'].map(s => <option key={s}>{s}</option>)}</select></td></tr>)}
          {!c.instruments.length && <tr><td colSpan={7}><p className="sub">No instrument on file for this customer.</p></td></tr>}</tbody></table></div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', alignItems: 'end' }}>
        <div className="fld"><label htmlFor="fi-type">Type</label><select id="fi-type" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{['Bank Guarantee', 'Letter of Credit', 'Cheque (PDC)', 'Director Approval'].map(t => <option key={t}>{t}</option>)}</select></div>
        <div className="fld"><label htmlFor="fi-bank">{f.type === 'Director Approval' ? 'Approved by' : 'Bank'}</label><input id="fi-bank" type="text" value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} /></div>
        <div className="fld"><label htmlFor="fi-ref">Number</label><input id="fi-ref" type="text" value={f.ref_no} onChange={e => setF({ ...f, ref_no: e.target.value })} /></div>
        <div className="fld"><label htmlFor="fi-amt">Amount (Rs) *</label><input id="fi-amt" type="number" min={0} value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></div>
        <div className="fld"><label htmlFor="fi-iss">Issue date</label><input id="fi-iss" type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></div>
        <div className="fld"><label htmlFor="fi-exp">{f.type === 'Cheque (PDC)' ? 'Cheque date *' : 'Expiry date *'}</label><input id="fi-exp" type="date" value={f.expiry_date} onChange={e => setF({ ...f, expiry_date: e.target.value })} /></div>
        <div><button className="btn" onClick={() => run(async () => { await call('/api/credit', { method: 'POST', json: { ...f, customer_id: c.id } }); setF({ type: f.type, bank: '', ref_no: '', amount: '', issue_date: '', expiry_date: '' }); }, 'Instrument added.')}>Add instrument</button></div></div>
    </section>}
  </>;
}

function Outstanding() {
  const [asOf, setAsOf] = useState(nptToday()); const [mode, setMode] = useState(''); const [rep, setRep] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ups, setUps] = useState<any[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => call('/api/credit/outstanding').then(r => setUps(r.uploads)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function upload() {
    const f = file.current?.files?.[0]; if (!f) { setErr('Choose the file exported from the accounting software.'); return; }
    if (!mode) { setErr('Choose what the file contains.'); return; }
    setBusy(true); setErr(''); setRep(null);
    try { const fd = new FormData(); fd.append('file', f); fd.append('as_of', asOf); fd.append('mode', mode); setRep(await call('/api/credit/outstanding', { method: 'POST', body: fd })); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return <>
    <section className="card"><h2>Upload outstanding and aging</h2>
      <p className="sub">This replaces a live link to the accounting software. Export customer-wise outstanding with aging buckets, put it in the template columns and upload it at least once a week. </p>
      <div className="fld" style={{ maxWidth: 560 }}><label htmlFor="os-mode">What does this file contain? *</label><select id="os-mode" value={mode} onChange={e => setMode(e.target.value)}><option value="">Select…</option>
        <option value="full">Every customer who has a balance (customers not in the file are set to zero)</option><option value="partial">Only some customers (the others keep their last figures)</option></select></div>
      <div className="toolbar"><div className="l"><input id="os-file" ref={file} type="file" accept=".xlsx,.csv" /><label className="user" htmlFor="os-asof">Figures as of <input id="os-asof" type="date" value={asOf} max={nptToday()} onChange={e => setAsOf(e.target.value)} /></label></div>
        <div className="r"><a className="btn" href="/api/credit/outstanding?template=1">Download template</a><button className="btn primary" disabled={busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      {rep && <><div className={rep.failed ? 'banner' : 'okbox'}>{rep.updated} customers updated, {rep.failed} rows skipped{rep.zeroed ? `, ${rep.zeroed} customers not in the file set to zero` : ''}.{rep.held ? ' Because some rows were skipped, no other customer was set to zero. Fix the rows and upload again.' : ''}</div>
        {rep.errors.length > 0 && <div className="tbl" style={{ maxHeight: 260, overflowY: 'auto' }}><table><thead><tr><th>Row</th><th>Why it was skipped</th></tr></thead><tbody>{rep.errors.map((x: any, i: number) => <tr key={i}><td className="num">{x.row}</td><td>{x.message}</td></tr>)}</tbody></table></div>}</>}
    </section>
    <section className="card"><h2>Previous uploads</h2><div className="tbl"><table><thead><tr><th>Uploaded</th><th>By</th><th>As of</th><th>File</th><th className="r">Updated</th><th className="r">Skipped</th></tr></thead>
      <tbody>{ups.map(u => <tr key={u.id}><td className="num">{when(u.at)}</td><td>{u.by || '–'}</td><td className="num">{u.as_of}</td><td>{u.file_name}</td><td className="r num">{u.rows_ok}</td><td className="r num">{u.rows_failed}</td></tr>)}
        {!ups.length && <tr><td colSpan={6}><p className="sub">Nothing uploaded yet. Until the first upload every customer shows zero outstanding.</p></td></tr>}</tbody></table></div></section>
  </>;
}

function AcceptedBooklets() {
  const [rows, setRows] = useState<any[] | null>(null); const [open, setOpen] = useState<number | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => call('/api/booklets?box=accepted').then(r => setRows(r.booklets)).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return <>{err && <div className="errbox" role="alert">{err}</div>}
    {(rows || []).map(b => <section className="card" key={b.id}><div className="hd"><div><h2>{b.customer}</h2><span className="code">{b.no} · {b.person} · valid to {b.due_date}</span></div>
      <div className="toolbar"><VarPill v={b.max_variance} /><Status s={b.status} /><button className="btn sm" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Close' : 'Open'}</button></div></div>
      {open === b.id && <BookletDetail id={b.id} onDone={() => { setOpen(null); load(); }} />}</section>)}
    {rows && !rows.length && <section className="card"><p className="sub">No accepted booklets right now.</p></section>}</>;
}

export default function Credit({ canCredit, canDispatch }: { canCredit: boolean; canDispatch: boolean }) {
  const tabs = [canCredit && ['queue', 'Order queue'], canCredit && ['customers', 'Customer credit'], canCredit && ['outstanding', 'Outstanding upload'], canCredit && ['booklets', 'Booklet review'], canDispatch && ['dispatch', 'Dispatch']].filter(Boolean) as string[][];
  const [tab, setTab] = useState(tabs[0][0]);
  return <>
    <section className="card"><div className="toolbar"><div className="l">{tabs.map(t => <button key={t[0]} className={`btn ${tab === t[0] ? 'primary' : ''}`} onClick={() => setTab(t[0])}>{t[1]}</button>)}</div></div></section>
    {tab === 'queue' && <OrderList key="q" box="queue" empty="No orders are waiting for credit approval." />}
    {tab === 'customers' && <Customers />}
    {tab === 'outstanding' && <Outstanding />}
    {tab === 'booklets' && <AcceptedBooklets />}
    {tab === 'dispatch' && <OrderList key="d" box="approved" empty="Nothing is waiting for dispatch." />}
  </>;
}
