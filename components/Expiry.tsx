'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';
import { when } from './SalesBits';

const sh = (n: number) => n >= 1e7 ? 'Rs ' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? 'Rs ' + (n / 1e5).toFixed(1) + ' L' : rs(n);

function Buyers({ id, canOrder, onClose }: { id: number; canOrder: boolean; onClose: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { setD(null); call(`/api/expiry?batch=${id}&match=1`).then(setD).catch(e => setErr(e.message)); }, [id]);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <p className="sub">Finding customers who can use this batch in time…</p>;
  const b = d.batch;
  return <section className="card enter" style={{ borderColor: 'var(--accent2)' }}>
    <div className="hd"><div><h2>Who can take {b.product}, batch {b.batch_no}?</h2><span className="code">expires {b.expiry_date} · {b.months_left} months left · {b.free_boxes} boxes free{b.offer ? ` · offer ${b.offer.text}, Rs ${b.offer.rate.toFixed(2)} against Rs ${b.trade_rate.toFixed(2)}` : ''}</span></div><button className="btn sm" onClick={onClose}>Close</button></div>
    <p className="sub">A customer is listed when their monthly offtake of this product, over the {d.usable_months ?? 0} months that can still be used, is more than the stock they already hold. One month is kept back for delivery and use.</p>
    <div className="tbl"><table><thead><tr><th>Customer</th><th>Type</th><th>Sales officer</th><th className="r">Uses per month</th><th className="r">Holds now</th><th className="r">Can take</th><th className="r">Value at offer</th><th></th></tr></thead>
      <tbody>{d.buyers.map((c: any) => <tr key={c.id}><td><a href={`/customers/${c.id}`}><b>{c.name}</b></a><br /><span className="code">{c.town || '–'}</span></td><td>{c.type}</td><td>{c.person || '–'}</td><td className="r num">{c.monthly}</td><td className="r num">{c.stock ?? '–'}</td>
        <td className="r num"><b>{c.can_take}</b> boxes</td><td className="r num">{b.offer ? rs(c.can_take * b.units_per_box * b.offer.rate) : '–'}</td>
        <td>{canOrder && b.offer && <a className="btn sm primary" href={`/orders?customer=${c.id}&batch=${b.id}&qty=${c.can_take}`}>Create order</a>}</td></tr>)}
        {!d.buyers.length && <tr><td colSpan={8}><p className="sub" style={{ padding: '10px 0' }}>{b.expired ? 'This batch has expired and cannot be sold.' : b.unsellable ? 'This batch is below the minimum shelf life in Settings and cannot be sold.' : 'No customer in your territory has bought or reported this product recently. Offer it to a high-volume hospital or distributor.'}</p></td></tr>}</tbody></table></div>
  </section>;
}

function Position({ canOrder }: { canOrder: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [only, setOnly] = useState('risk'); const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { call('/api/expiry').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Reading the stock…</p></section>;
  if (!d.rows.length) return <section className="card"><h2>No stock has been uploaded yet</h2><p className="sub">Upload the batch-wise stock (product code, batch, expiry, boxes) from the accounting software on the "Upload stock" tab. Until then the system cannot see what is close to expiry.</p></section>;
  const rows = d.rows.filter((b: any) => only === 'all' || (only === 'risk' ? b.at_risk > 0 || b.expired : only === 'offer' ? !!b.offer : b.months_left <= d.near_months));
  const mx = Math.max(1, ...d.ladder.map((l: any) => l.value));
  return <>
    <div className="g kpi">
      <div className="card"><div className="lab">Will not sell in time</div><div className="big" style={{ color: d.at_risk_value > 0 ? 'var(--crit)' : undefined }}>{sh(d.at_risk_value)}</div><div className="ctx">{d.at_risk_boxes} boxes at today's rate of sale</div></div>
      <div className="card"><div className="lab">Stock value</div><div className="big">{sh(d.total_value)}</div><div className="ctx">at trade rate · as of {d.as_of}</div></div>
      <div className="card"><div className="lab">With an offer price</div><div className="big">{d.rows.filter((b: any) => b.offer).length}</div><div className="ctx">batches inside an offer slab</div></div>
    </div>
    <section className="card"><div className="hd"><h2>Stock by time to expiry</h2><span className="sub">value at trade rate</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{d.ladder.map((l: any) => <div key={l.label}><div className="hd"><span>{l.label} <span className="code">{l.batches} batches · {l.boxes} boxes</span></span><span className="num">{sh(l.value)}</span></div>
        <div style={{ height: 12, background: 'var(--sunk)', borderRadius: 4 }}><div style={{ height: '100%', width: `${l.value / mx * 100}%`, borderRadius: '0 4px 4px 0', background: l.k === 'crit' ? 'var(--crit-fill)' : l.k === 'warn' ? 'var(--warn-fill)' : l.k === 'good' ? 'var(--good-fill)' : 'var(--accent2)' }} /></div></div>)}</div></section>
    {sel && <Buyers id={sel} canOrder={canOrder} onClose={() => setSel(null)} />}
    <section className="card"><div className="toolbar"><div className="l"><h2>Batches</h2></div><div className="r"><label className="user" htmlFor="ex-only">Show <select id="ex-only" value={only} onChange={e => setOnly(e.target.value)}>
      <option value="risk">Will not sell in time</option><option value="offer">With an offer price</option><option value="near">Expiring within {d.near_months} months</option><option value="all">All stock (earliest expiry first)</option></select></label></div></div>
      <div className="tbl"><table><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th className="r">Free boxes</th><th className="r">Sells per month</th><th className="r">Left over</th><th className="r">Value left over</th><th>Offer</th><th></th></tr></thead>
        <tbody>{rows.map((b: any) => <tr key={b.id} style={sel === b.id ? { background: 'var(--accent-soft)' } : undefined}><td><b>{b.product}</b><br /><span className="code">{b.code} · {b.pack_size || ''}{b.location !== 'Main' ? ` · ${b.location}` : ''}</span></td><td className="code">{b.batch_no}</td>
          <td><span className="num">{b.expiry_date}</span> <span className={`pill ${b.expired || b.months_left <= 3 ? 'crit' : b.months_left <= 6 ? 'warn' : ''}`}>{b.expired ? 'Expired' : `${b.months_left} ${b.months_left === 1 ? "month" : "months"}`}</span></td>
          <td className="r num">{b.free_boxes}</td><td className="r num">{b.run_rate || '–'}</td><td className="r num">{b.at_risk ? <b style={{ color: 'var(--crit)' }}>{b.at_risk}</b> : '–'}</td><td className="r num">{b.risk_value ? rs(b.risk_value) : '–'}</td>
          <td>{b.offer ? <><span className="pill good">{b.offer.text}</span><br /><span className="code">Rs {b.offer.rate.toFixed(2)} vs {b.trade_rate.toFixed(2)}</span></> : b.expired ? <span className="pill crit">Cannot be sold</span> : b.unsellable ? <span className="pill crit">Below {d.min_shelf} months</span> : <span className="code">standard rate</span>}</td>
          <td>{!b.expired && !b.unsellable && <button className="btn sm primary" onClick={() => { setSel(b.id); window.scrollTo({ top: 300, behavior: 'smooth' }); }}>Find buyers</button>}</td></tr>)}
          {!rows.length && <tr><td colSpan={9}><p className="sub" style={{ padding: '10px 0' }}>{only === 'risk' ? 'At today’s rate of sale every batch will sell before it gets too close to expiry.' : 'No batch matches this view.'}</p></td></tr>}</tbody></table></div>
      <p className="sub">"Left over" walks each product's batches in expiry order: what the monthly sale of the last 90 days can clear before the batch reaches the minimum shelf life ({d.min_shelf} months), and what remains. Free boxes are the uploaded quantity minus near-expiry orders taken since the upload.</p></section>
  </>;
}

function Upload({ onDone }: { onDone: () => void }) {
  const [asOf, setAsOf] = useState(nptToday()); const [mode, setMode] = useState(''); const [rep, setRep] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ups, setUps] = useState<any[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => call('/api/expiry/stock').then(r => setUps(r.uploads)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function upload() {
    const f = file.current?.files?.[0]; if (!f) { setErr('Choose the stock file exported from the accounting software.'); return; }
    if (!mode) { setErr('Choose what the file contains.'); return; }
    setBusy(true); setErr(''); setRep(null);
    try { const fd = new FormData(); fd.append('file', f); fd.append('as_of', asOf); fd.append('mode', mode); setRep(await call('/api/expiry/stock', { method: 'POST', body: fd })); load(); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return <>
    <section className="card"><h2>Upload batch-wise stock</h2>
      <p className="sub">Export the finished-goods stock with batch and expiry from the accounting software, put it in the template columns and upload it, ideally every week. Expiry can be written as 2027-03-31 or 03/2027.</p>
      <div className="fld" style={{ maxWidth: 560 }}><label htmlFor="sk-mode">What does this file contain? *</label><select id="sk-mode" value={mode} onChange={e => setMode(e.target.value)}><option value="">Select…</option>
        <option value="full">The whole stock (batches not in the file are set to zero)</option><option value="partial">Only some batches (the others keep their last figures)</option></select></div>
      <div className="toolbar"><div className="l"><input id="sk-file" ref={file} type="file" accept=".xlsx,.csv" /><label className="user" htmlFor="sk-asof">Stock as of <input id="sk-asof" type="date" value={asOf} max={nptToday()} onChange={e => setAsOf(e.target.value)} /></label></div>
        <div className="r"><a className="btn" href="/api/expiry/stock?template=1">Download template</a><button className="btn primary" disabled={busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      {rep && <><div className={rep.failed ? 'banner' : 'okbox'}>{rep.updated} batches updated, {rep.failed} rows skipped{rep.zeroed ? `, ${rep.zeroed} batches not in the file set to zero` : ''}.{rep.held ? ' Because some rows were skipped, no other batch was set to zero. Fix the rows and upload again.' : ''}</div>
        {rep.errors.length > 0 && <div className="tbl" style={{ maxHeight: 260, overflowY: 'auto' }}><table><thead><tr><th>Row</th><th>Why it was skipped</th></tr></thead><tbody>{rep.errors.map((x: any, i: number) => <tr key={i}><td className="num">{x.row}</td><td>{x.message}</td></tr>)}</tbody></table></div>}</>}
    </section>
    <section className="card"><h2>Previous uploads</h2><div className="tbl"><table><thead><tr><th>Uploaded</th><th>By</th><th>As of</th><th>File</th><th>Kind</th><th className="r">Updated</th><th className="r">Skipped</th></tr></thead>
      <tbody>{ups.map(u => <tr key={u.id}><td className="num">{when(u.at)}</td><td>{u.by || '–'}</td><td className="num">{u.as_of}</td><td>{u.file_name}</td><td>{u.mode === 'full' ? 'Whole stock' : 'Some batches'}</td><td className="r num">{u.rows_ok}</td><td className="r num">{u.rows_failed}</td></tr>)}
        {!ups.length && <tr><td colSpan={7}><p className="sub">Nothing uploaded yet.</p></td></tr>}</tbody></table></div></section>
  </>;
}

function Slabs({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call('/api/expiry/offers').then(r => setRows(r.slabs.map((x: any) => ({ ...x, bonus_buy: x.bonus_buy || '', bonus_free: x.bonus_free || '' })))).catch(e => setErr(e.message)); }, []);
  const set = (i: number, k: string, v: string) => setRows(rs2 => rs2.map((r, j) => j === i ? { ...r, [k]: v } : r));
  async function save() { setBusy(true); setErr(''); try { await call('/api/expiry/offers', { method: 'PUT', json: { slabs: rows } }); toast('Offer slabs saved. They apply to the next order.'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  return <section className="card"><div className="hd"><h2>Near-expiry offer slabs</h2><span className="sub">a pre-approved price by months left; no booklet is needed</span></div>
    <p className="sub">Stock inside a slab can be ordered at that price straight away and is sold as non-returnable: a later expiry claim for that batch is refused. Stock with less shelf life than the minimum in Settings cannot be sold at all.</p>
    {err && <div className="errbox" role="alert">{err}</div>}
    <div className="tbl"><table><thead><tr><th>From (months left)</th><th>To (months left)</th><th>Discount %</th><th>Bonus: buy</th><th>Bonus: free</th><th></th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{(['months_from', 'months_to', 'discount_pct', 'bonus_buy', 'bonus_free'] as const).map(k => <td key={k}><input type="number" min={0} step={k.startsWith('months') ? '0.5' : k === 'discount_pct' ? '0.5' : '1'} aria-label={`Slab ${i + 1}: ${k}`} value={r[k]} disabled={!canManage} onChange={e => set(i, k, e.target.value)} style={{ width: 110 }} /></td>)}
        <td>{canManage && <button className="btn sm" onClick={() => setRows(x => x.filter((_, j) => j !== i))}>Remove</button>}</td></tr>)}
        {!rows.length && <tr><td colSpan={6}><p className="sub">No slab: near-expiry stock is sold at the standard rate.</p></td></tr>}</tbody></table></div>
    {canManage && <div className="toolbar"><div className="l"><button className="btn" onClick={() => setRows(x => [...x, { months_from: x.length ? x[x.length - 1].months_to : 0, months_to: x.length ? Number(x[x.length - 1].months_to) + 3 : 3, discount_pct: 10, bonus_buy: '', bonus_free: '' }])}>Add slab</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save slabs'}</button></div></div>}
  </section>;
}

function Loss() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { call('/api/expiry?loss=1').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Adding it up…</p></section>;
  const mx = Math.max(1, ...d.months.map((m: any) => m.amount)), r = d.returns;
  return <>
    <div className="g kpi">
      <div className="card"><div className="lab">Expired in the godown</div><div className="big" style={{ color: d.godown.expired_value > 0 ? 'var(--crit)' : undefined }}>{sh(d.godown.expired_value)}</div><div className="ctx">{d.godown.expired_boxes} boxes already lost</div></div>
      <div className="card"><div className="lab">Expiry returns, 12 months</div><div className="big">{sh(r.total)}</div><div className="ctx">{r.count} claims · {r.pct_of_sales == null ? 'no sales to compare' : `${r.pct_of_sales}% of sales`} · limit {r.cap_pct}%</div></div>
      <div className="card"><div className="lab">Returns waiting</div><div className="big">{sh(r.waiting)}</div><div className="ctx">{sh(r.accepted)} approved or settled</div></div>
      <div className="card"><div className="lab">Saved by near-expiry selling</div><div className="big" style={{ color: d.lots.sold > 0 ? 'var(--good)' : undefined }}>{sh(d.lots.sold)}</div><div className="ctx">{d.lots.boxes} boxes sold · {sh(d.lots.given)} given as offer</div></div>
    </div>
    <section className="card"><div className="hd"><h2>Expiry returns by month</h2><span className="sub">claims not rejected or withdrawn</span></div>
      {!d.months.length ? <p className="sub">No expiry claim in the last 12 months.</p> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{d.months.map((m: any) => <div key={m.month}><div className="hd"><span className="num">{m.month} <span className="code">{m.n} claims</span></span><span className="num">{rs(m.amount)}</span></div>
          <div style={{ height: 10, background: 'var(--sunk)', borderRadius: 4 }}><div style={{ height: '100%', width: `${m.amount / mx * 100}%`, borderRadius: '0 4px 4px 0', background: 'var(--warn-fill)' }} /></div></div>)}</div>}</section>
    <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))' }}>
      <section className="card"><h2>Customers returning the most</h2>
        {!d.byCustomer.length ? <p className="sub">Nothing to show.</p> : <div className="tbl"><table><thead><tr><th>Customer</th><th className="r">Claims</th><th className="r">Returned</th><th className="r">Of purchases</th></tr></thead>
          <tbody>{d.byCustomer.map((c: any) => <tr key={c.id}><td><a href={`/customers/${c.id}`}><b>{c.customer}</b></a></td><td className="r num">{c.n}</td><td className="r num">{rs(c.amount)}</td><td className="r">{c.pct == null ? <span className="pill crit">no purchases</span> : <span className={`pill ${c.over ? 'crit' : 'good'}`}>{c.pct}%</span>}</td></tr>)}</tbody></table></div>}</section>
      <section className="card"><h2>Products coming back the most</h2>
        {!d.byProduct.length ? <p className="sub">Nothing to show.</p> : <div className="tbl"><table><thead><tr><th>Product</th><th className="r">Boxes</th><th className="r">Returned</th></tr></thead>
          <tbody>{d.byProduct.map((x: any) => <tr key={x.code}><td><b>{x.product}</b><br /><span className="code">{x.code}</span></td><td className="r num">{x.boxes}</td><td className="r num">{rs(x.amount)}</td></tr>)}</tbody></table></div>}</section>
    </div>
    <section className="card"><p className="sub">A product that keeps coming back is being pushed into the market faster than it sells: lower the quantity per order there, or run a scheme for the retailer instead of the distributor. A customer in red is over the yearly returns limit set in Settings.</p></section>
  </>;
}

function Short() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { call('/api/expiry?shortage=1').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Comparing open orders with stock…</p></section>;
  if (!d.rows.length) return <section className="card"><h2>No product is short</h2><p className="sub">Open orders (pending and approved, not yet dispatched) fit inside the sellable stock of every product that has stock figures.</p></section>;
  return <>{d.rows.map((p: any) => <section className="card" key={p.product_id}>
    <div className="hd"><div><h2>{p.product}</h2><span className="code">{p.code} · {p.stock} boxes sellable · {p.ordered} ordered</span></div><span className="pill crit">{p.short} boxes short</span></div>
    <div className="tbl"><table><thead><tr><th>Order</th><th>Customer</th><th className="r">Usually buys / month</th><th className="r">Ordered</th><th className="r">Fair share</th></tr></thead>
      <tbody>{p.lines.map((l: any) => <tr key={l.order_id}><td><span className="code">{l.no}</span> <span className={`pill ${l.status === 'Approved' ? 'good' : 'warn'}`}>{l.status}</span></td><td><a href={`/customers/${l.customer_id}`}><b>{l.customer}</b></a></td>
        <td className="r num">{l.usual || '–'}</td><td className="r num">{l.qty}</td><td className="r"><b className="num">{l.share}</b>{l.share < l.qty && <><br /><span className="code">{l.qty - l.share} later</span></>}</td></tr>)}</tbody></table></div>
  </section>)}
    <section className="card"><p className="sub">The share follows what each customer normally buys (average of the last 90 days of dispatches), never more than it ordered. A customer with no history gets a small share of what it asked for. This is a guide for dispatch; it does not change any order.</p></section></>;
}

export default function Expiry({ canManage, canOrder, canLoss }: { canManage: boolean; canOrder: boolean; canLoss: boolean }) {
  const tabs = [['pos', 'Expiry position'], ['slabs', 'Offer slabs'], canLoss && ['loss', 'Loss and returns'], canManage && ['short', 'Short stock'], canManage && ['upload', 'Upload stock']].filter(Boolean) as string[][];
  const [tab, setTab] = useState('pos'); const [n, setN] = useState(0);
  return <>
    <section className="card"><div className="toolbar"><div className="l">{tabs.map(t => <button key={t[0]} className={`btn ${tab === t[0] ? 'primary' : ''}`} onClick={() => setTab(t[0])}>{t[1]}</button>)}</div></div></section>
    {tab === 'pos' && <Position key={n} canOrder={canOrder} />}
    {tab === 'slabs' && <Slabs canManage={canManage} />}
    {tab === 'loss' && <Loss />}
    {tab === 'short' && <Short />}
    {tab === 'upload' && <Upload onDone={() => setN(x => x + 1)} />}
  </>;
}
