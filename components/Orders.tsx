'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { CreditBox, Status, Trail } from './SalesBits';
import FilterBar, { Filter, filterQuery, noFilter } from './FilterBar';

export function OrderDetail({ id, onDone }: { id: number; onDone: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [rm, setRm] = useState(''); const [inv, setInv] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call(`/api/orders/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  async function act(action: string) { setBusy(true); setErr(''); try { const r = await call(`/api/orders/${id}`, { method: 'POST', json: { action, remarks: rm, invoice_no: inv } }); toast(r.status === 'Approved' ? 'Order approved. It is now waiting for dispatch.' : `Order ${r.status.toLowerCase()}.`); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  if (!d) return err ? <div className="errbox" role="alert">{err}</div> : <p className="sub">Loading…</p>;
  const o = d.order;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tbl"><table><thead><tr><th>Product</th><th className="r">Boxes</th><th className="r">Units/box</th><th className="r">Rate</th><th className="r">Value</th></tr></thead>
        <tbody>{d.items.map((i: any) => <tr key={i.id}><td><b>{i.product}</b><br /><span className="code">{i.product_code} · {i.pack_size || ''}</span></td><td className="r num">{i.qty}</td><td className="r num">{i.units_per_box}</td><td className="r num">{i.rate.toFixed(2)}</td><td className="r num">{rs(i.value)}</td></tr>)}</tbody></table></div>
      <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <div><div className="lab">Payment term</div>{o.term || '–'}</div><div><div className="lab">Transport</div>{o.transport}{o.transporter ? ` · ${o.transporter}` : ''}{o.vehicle_no ? ` · ${o.vehicle_no}` : ''}</div>
        <div><div className="lab">Deliver to</div>{o.delivery_address || '–'}</div><div><div className="lab">Contact</div>{o.contact_person || '–'} {o.contact_phone || ''}</div>
        {o.invoice_no && <div><div className="lab">Invoice</div><span className="num">{o.invoice_no}</span></div>}</div>
      {o.remarks && <p className="sub">Remarks: {o.remarks}</p>}
      <CreditBox c={d.credit} />
      {err && <div className="errbox" role="alert">{err}</div>}
      {d.canDecide && <div className="toolbar"><div className="l" style={{ flex: 1 }}><input type="text" id={`od-rm-${id}`} aria-label="Remarks" placeholder={o.over_now ? 'Over limit: name the instrument or approval that covers it' : 'Remarks (needed to reject)'} value={rm} onChange={e => setRm(e.target.value)} style={{ flex: 1, minWidth: 220 }} /></div>
        <div className="r"><button className="btn primary" disabled={busy} onClick={() => act('approve')}>Approve</button><button className="btn danger" disabled={busy} onClick={() => act('reject')}>Reject</button></div></div>}
      {d.canDispatch && <div className="toolbar"><div className="l"><div className="fld"><label htmlFor={`od-inv-${id}`}>Invoice number (optional)</label><input id={`od-inv-${id}`} type="text" value={inv} onChange={e => setInv(e.target.value)} /></div></div>
        <div className="r"><button className="btn primary" disabled={busy} onClick={() => act('dispatch')}>Mark dispatched</button></div></div>}
      <div><a className="btn sm" href={`/print/order/${id}`} target="_blank" rel="noreferrer">Print or save as PDF</a></div>
      {d.canWithdraw && <div><button className="btn" disabled={busy} onClick={() => act('withdraw')}>Withdraw order</button></div>}
      <Trail rows={d.trail} />
    </div>
  );
}

export const OrderCard = ({ o, open, toggle, onDone }: { o: any; open: boolean; toggle: () => void; onDone: () => void }) => (
  <section className="card">
    <div className="hd"><div><h2>{o.customer}</h2><span className="code">{o.no} · {o.person} · {o.order_date}{o.booklet_no ? ` · booklet ${o.booklet_no}` : ' · standard rates'}</span></div>
      <div className="toolbar">{o.status === 'Pending' && <span className={`pill ${(o.over_now ?? o.over_limit) ? 'crit' : 'good'}`}>{(o.over_now ?? o.over_limit) ? 'Over limit' : 'Within limit'}</span>}{o.dda_expired && <span className="pill crit">DDA expired</span>}
        <Status s={o.status} /><b className="num">{rs(o.value)}</b><button className="btn sm" onClick={toggle}>{open ? 'Close' : 'Open'}</button></div></div>
    {open && <OrderDetail id={o.id} onDone={onDone} />}
  </section>
);

function NewOrder({ onDone }: { onDone: () => void }) {
  const [custs, setCusts] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]); const [terms, setTerms] = useState<any[]>([]);
  const [cust, setCust] = useState(''); const [credit, setCredit] = useState<any>(null); const [bks, setBks] = useState<any[]>([]); const [bk, setBk] = useState(''); const [bkItems, setBkItems] = useState<any[]>([]);
  const [lines, setLines] = useState<{ product_id: string; qty: string }[]>([{ product_id: '', qty: '10' }]);
  const [f, setF] = useState({ payment_term_id: '', transport: 'Company', transporter: '', vehicle_no: '', remarks: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call('/api/m/customers?size=500').then(r => setCusts(r.rows)).catch(e => setErr(e.message)); call('/api/m/products?size=500').then(r => setProds(r.rows)).catch(() => {}); call('/api/m/terms/options').then(r => setTerms(r.options)).catch(() => {}); }, []);
  useEffect(() => {
    setCredit(null); setBks([]); setBk(''); setBkItems([]); setLines([{ product_id: '', qty: '10' }]); if (!cust) return;
    call(`/api/credit?customer=${cust}`).then(r => setCredit(r.credit)).catch(() => {});
    call(`/api/booklets?box=usable&customer=${cust}`).then(r => setBks(r.booklets)).catch(() => {});
    setF(x => ({ ...x, payment_term_id: String(custs.find(c => String(c.id) === cust)?.payment_term_id ?? '') }));
  }, [cust, custs]);
  useEffect(() => { if (!bk) { setBkItems([]); setLines([{ product_id: '', qty: '10' }]); return; } call(`/api/booklets/${bk}`).then(r => { setBkItems(r.items); setLines(r.items.map((i: any) => ({ product_id: String(i.product_id), qty: String(Math.max(0, i.balance)) }))); }).catch(e => setErr(e.message)); }, [bk]);
  const P = useMemo(() => new Map(prods.map(p => [String(p.id), p])), [prods]);
  const rate = (pid: string) => bk ? bkItems.find(i => String(i.product_id) === pid)?.net_rate ?? 0 : P.get(pid)?.trade_rate ?? 0;
  const upb = (pid: string) => bk ? bkItems.find(i => String(i.product_id) === pid)?.units_per_box ?? 0 : P.get(pid)?.units_per_box ?? 0;
  const value = lines.reduce((a, l) => a + (Number(l.qty) || 0) * upb(l.product_id) * rate(l.product_id), 0), over = credit && value > credit.available;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); if (!cust) { setErr('Choose a customer.'); return; } setBusy(true);
    try { const r = await call('/api/orders', { method: 'POST', json: { customer_id: Number(cust), booklet_id: bk ? Number(bk) : null, items: lines.filter(l => l.product_id), ...f } }); toast(`${r.no} sent to Credit Control${r.over_limit ? ' (over limit)' : ''}.`); onDone(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>New sales order</h2>
      <div className="form"><div className="fld"><label htmlFor="od-cust">Customer *</label><select id="od-cust" value={cust} onChange={e => setCust(e.target.value)}><option value="">Select…</option>{custs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></div>
        <div className="fld"><label htmlFor="od-bk">Approved booklet</label><select id="od-bk" value={bk} onChange={e => setBk(e.target.value)} disabled={!cust}><option value="">None (standard rates)</option>{bks.map(b => <option key={b.id} value={b.id}>{b.no} · valid to {b.due_date}</option>)}</select><small>{cust && !bks.length ? 'No accepted booklet for this customer.' : 'Special rates come only from an approved booklet.'}</small></div>
        <div className="fld"><label htmlFor="od-term">Payment term</label><select id="od-term" value={f.payment_term_id} onChange={e => setF({ ...f, payment_term_id: e.target.value })}><option value="">Customer default</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        <div className="fld"><label htmlFor="od-tr">Transport</label><select id="od-tr" value={f.transport} onChange={e => setF({ ...f, transport: e.target.value })}><option>Company</option><option>Customer</option></select></div>
        <div className="fld"><label htmlFor="od-trn">Transporter name</label><input id="od-trn" type="text" value={f.transporter} onChange={e => setF({ ...f, transporter: e.target.value })} /></div>
        <div className="fld"><label htmlFor="od-veh">Vehicle number</label><input id="od-veh" type="text" value={f.vehicle_no} onChange={e => setF({ ...f, vehicle_no: e.target.value })} /></div></div>
      {credit && <CreditBox c={credit} />}
      {lines.map((l, i) => { const p = bk ? bkItems.find(x => String(x.product_id) === l.product_id) : P.get(l.product_id); return <div key={i} style={{ background: 'var(--canvas)', borderRadius: 10, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        {bk ? <div style={{ gridColumn: 'span 2' }}><div className="lab">Product (from booklet)</div><b>{p?.product}</b></div>
          : <div className="fld" style={{ gridColumn: 'span 2' }}><label htmlFor={`ol${i}-p`}>Product *</label><select id={`ol${i}-p`} value={l.product_id} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}><option value="">Select…</option>{prods.map(x => <option key={x.id} value={x.id}>{x.name} {x.pack_size || ''} ({x.code})</option>)}</select></div>}
        <div className="fld"><label htmlFor={`ol${i}-q`}>Boxes{bk && p ? ` (balance ${p.balance})` : ''}</label><input id={`ol${i}-q`} type="number" min={0} value={l.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
        <div><div className="lab">Rate</div><div className="num">{rate(l.product_id) ? Number(rate(l.product_id)).toFixed(2) : '–'}</div></div>
        <div><div className="lab">Value</div><div className="num">{rs((Number(l.qty) || 0) * upb(l.product_id) * rate(l.product_id))}</div></div>
        {!bk && lines.length > 1 && <div><button type="button" className="btn sm" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</button></div>}</div>; })}
      <div className="toolbar"><div className="l">{!bk && <button type="button" className="btn" onClick={() => setLines(ls => [...ls, { product_id: '', qty: '10' }])}>Add product</button>}</div>
        <div className="r">{credit && <span className={`pill ${over ? 'crit' : 'good'}`}>{over ? 'Over limit' : 'Within limit'}</span>}<b className="num">{rs(value)}</b></div></div>
      <div className="fld"><label htmlFor="od-rem">Remarks</label><input id="od-rem" type="text" value={f.remarks} onChange={e => setF({ ...f, remarks: e.target.value })} /></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="toolbar"><div className="l"><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Submit to Credit Control'}</button><button type="button" className="btn" onClick={onDone}>Discard</button></div></div>
    </form>
  );
}

export default function Orders({ canCreate, canAll }: { canCreate: boolean; canAll: boolean }) {
  const boxes = [canCreate && ['mine', 'My orders'], canAll && ['all', 'All']].filter(Boolean) as string[][];
  const [box, setBox] = useState(boxes[0]?.[0] || 'all'); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<number | null>(null); const [adding, setAdding] = useState(false); const [flt, setFlt] = useState<Filter>(noFilter);
  const load = useCallback(() => call(`/api/orders?box=${box}${filterQuery(flt)}`).then(r => { setRows(r.orders); setErr(''); }).catch(e => setErr(e.message)), [box, flt]);
  useEffect(() => { setRows(null); setOpen(null); load(); }, [load]);
  return (
    <>
      <section className="card"><div className="toolbar"><div className="l">{boxes.map(b => <button key={b[0]} className={`btn ${box === b[0] ? 'primary' : ''}`} onClick={() => { setBox(b[0]); setFlt(noFilter); }}>{b[1]}</button>)}</div>
        <div className="r">{canCreate && !adding && <button className="btn primary" onClick={() => setAdding(true)}>New sales order</button>}</div></div>
        <FilterBar id="od" statuses={['Pending', 'Approved', 'Dispatched', 'Rejected', 'Withdrawn']} value={flt} onChange={setFlt} hint="Search number, customer or person" /></section>
      {adding && <NewOrder onDone={() => { setAdding(false); load(); }} />}
      {err && <div className="errbox" role="alert">{err}</div>}
      {(rows || []).map(o => <OrderCard key={o.id} o={o} open={open === o.id} toggle={() => setOpen(open === o.id ? null : o.id)} onDone={() => { setOpen(null); load(); }} />)}
      {rows && !rows.length && <section className="card"><p className="sub">{flt !== noFilter ? 'No sales order matches these filters.' : 'No sales orders here yet.'}</p></section>}
    </>
  );
}
