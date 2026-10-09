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
        <tbody>{d.items.map((i: any) => <tr key={i.id}><td><b>{i.product}</b>{i.non_returnable && <span className="pill warn" style={{ marginLeft: 6 }}>Near-expiry lot · non-returnable</span>}<br /><span className="code">{i.product_code} · {i.pack_size || ''}{i.batch_no ? ` · batch ${i.batch_no}${i.expiry_date ? ', exp ' + i.expiry_date : ''}` : ''}</span>{i.scheme_text && <><br /><span className="pill good">Scheme {i.scheme_text}{i.free_qty ? ` · ${i.free_qty} free boxes` : ''}</span></>}{(i.price_source === 'customer' || i.price_source === 'type') && <><br /><span className="sub">{i.price_source === 'customer' ? 'Contract rate' : 'Price-list rate'}</span></>}{i.fefo && <><br /><span className="sub">Send first: {i.fefo.plan.map((x: any) => `${x.batch_no} (exp ${x.expiry_date}) × ${x.qty}`).join(', ')}{i.fefo.short ? ` · ${i.fefo.short} boxes not in uploaded stock` : ''}</span></>}</td><td className="r num">{i.qty}</td><td className="r num">{i.units_per_box}</td><td className="r num">{i.rate.toFixed(2)}</td><td className="r num">{rs(i.value)}</td></tr>)}</tbody></table></div>
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

type Init = { customer?: string; booklet?: string; repeat?: boolean; product?: string; qty?: string; batch?: string };
type Line = { product_id: string; qty: string; batch_id?: number; lot?: any };
function NewOrder({ onDone, init }: { onDone: () => void; init?: Init }) {
  const [custs, setCusts] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]); const [terms, setTerms] = useState<any[]>([]);
  const [cust, setCust] = useState(''); const [credit, setCredit] = useState<any>(null); const [bks, setBks] = useState<any[]>([]); const [bk, setBk] = useState(''); const [bkItems, setBkItems] = useState<any[]>([]);
  const [lines, setLines] = useState<Line[]>([{ product_id: '', qty: '10' }]);
  const [f, setF] = useState({ payment_term_id: '', transport: 'Company', transporter: '', vehicle_no: '', remarks: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call('/api/m/customers?size=500').then(r => setCusts(r.rows)).catch(e => setErr(e.message)); call('/api/m/products?size=500').then(r => setProds(r.rows)).catch(() => {}); call('/api/m/terms/options').then(r => setTerms(r.options)).catch(() => {}); }, []);
  const [note, setNote] = useState(''); const [pricing, setPricing] = useState<any>({ rates: {}, schemes: [] });
  async function repeat(c: string) {
    try { const r = await call(`/api/sales/last-order?customer=${c}`);
      if (!r.order) { setNote('This customer has no earlier order to repeat.'); return; }
      setBk(''); setLines(r.items.map((i: any) => ({ product_id: String(i.product_id), qty: String(i.qty) }))); setNote(`Filled from ${r.order.no} of ${r.order.order_date}. Change the quantities if needed. Rates are today's standard rates.`);
    } catch (e: any) { setErr(e.message); }
  }
  // Opened from a customer page, a visit, a booklet or an opportunity: start with that customer already chosen.
  useEffect(() => { if (init?.customer && custs.length && !cust) setCust(init.customer); }, [init, custs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCredit(null); setBks([]); setBk(''); setBkItems([]); setNote(''); setPricing({ rates: {}, schemes: [] }); setLines([{ product_id: '', qty: '10' }]); if (!cust) return;
    call(`/api/pricing?customer=${cust}`).then(setPricing).catch(() => {});
    call(`/api/credit?customer=${cust}`).then(r => setCredit(r.credit)).catch(() => {});
    call(`/api/booklets?box=usable&customer=${cust}`).then(r => { setBks(r.booklets); if (init?.customer === cust && init.booklet && r.booklets.some((b: any) => String(b.id) === init.booklet)) setBk(init.booklet); }).catch(() => {});
    if (init?.customer === cust && init.repeat) repeat(cust);
    if (init?.customer === cust && init.product) setLines([{ product_id: init.product, qty: init.qty || '10' }]);
    if (init?.customer === cust && init.batch) call(`/api/expiry?batch=${init.batch}`).then(r => { const b = r.batch; if (!b.offer) { setNote(`Batch ${b.batch_no} has no near-expiry offer right now.`); return; } setLines([{ product_id: String(b.product_id), qty: init.qty || String(b.free_boxes), batch_id: b.id, lot: b }]); }).catch(e => setErr(e.message));
    setF(x => ({ ...x, payment_term_id: String(custs.find(c => String(c.id) === cust)?.payment_term_id ?? '') }));
  }, [cust, custs]);
  useEffect(() => { if (!bk) { setBkItems([]); setLines([{ product_id: '', qty: '10' }]); return; } call(`/api/booklets/${bk}`).then(r => { setBkItems(r.items); setLines(r.items.map((i: any) => ({ product_id: String(i.product_id), qty: String(Math.max(0, i.balance)) }))); }).catch(e => setErr(e.message)); }, [bk]);
  const P = useMemo(() => new Map(prods.map(p => [String(p.id), p])), [prods]);
  const listRate = (pid: string) => pricing.rates[pid]?.rate ?? P.get(pid)?.trade_rate ?? 0;
  // Mirrors the server: the best running scheme on a standard line; a contract rate takes no scheme on top.
  const scheme = (l: Line) => { if (l.lot || bk || !l.product_id || pricing.rates[l.product_id]?.source === 'customer') return { got: null as any, next: null as any };
    const qty = Number(l.qty) || 0, u = P.get(l.product_id)?.units_per_box ?? 0, r = listRate(l.product_id), mine = pricing.schemes.filter((x: any) => String(x.product_id) === l.product_id); let got: any = null;
    for (const x of mine) { if (qty < x.min_qty) continue; const free = x.bonus_free > 0 ? Math.floor(qty / x.bonus_buy) * x.bonus_free : 0, worth = free * u * r + qty * u * r * x.discount_pct / 100; if ((free || x.discount_pct) && (!got || worth > got.worth)) got = { s: x, free, worth }; }
    // The nudge: how many more boxes reach a scheme, or the next free box.
    let next: any = null;
    if (!got) { const x = mine.slice().sort((a: any, b: any) => a.min_qty - b.min_qty)[0]; if (x) next = { more: Math.max(x.min_qty, x.bonus_free > 0 ? x.bonus_buy : 0) - qty, text: x.text }; }
    else if (got.s.bonus_free > 0) { const more = got.s.bonus_buy - (qty % got.s.bonus_buy); if (more <= Math.ceil(got.s.bonus_buy * 0.3)) next = { more, text: `${got.s.bonus_free} more free` }; }
    return { got, next: next && next.more > 0 ? next : null }; };
  const rate = (pid: string, lot?: any, l?: Line) => { if (lot) return lot.offer.rate; if (bk) return bkItems.find(i => String(i.product_id) === pid)?.net_rate ?? 0; const g = l ? scheme(l).got : null; return Math.round(listRate(pid) * (1 - (g?.s.discount_pct || 0) / 100) * 10000) / 10000; };
  const upb = (pid: string) => bk ? bkItems.find(i => String(i.product_id) === pid)?.units_per_box ?? 0 : P.get(pid)?.units_per_box ?? 0;
  const value = lines.reduce((a, l) => a + (Number(l.qty) || 0) * upb(l.product_id) * rate(l.product_id, l.lot, l), 0), over = credit && value > credit.available;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); if (!cust) { setErr('Choose a customer.'); return; } setBusy(true);
    try { const r = await call('/api/orders', { method: 'POST', json: { customer_id: Number(cust), booklet_id: bk ? Number(bk) : null, items: lines.filter(l => l.product_id).map(l => ({ product_id: l.product_id, qty: l.qty, batch_id: l.batch_id })), ...f } }); toast(`${r.no} sent to Credit Control${r.over_limit ? ' (over limit)' : ''}.`); onDone(); }
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
      {cust && !bk && <div className="toolbar"><div className="l"><button type="button" className="btn" onClick={() => repeat(cust)}>Repeat last order</button>{note && <span className="sub">{note}</span>}</div></div>}
      {lines.map((l, i) => { const p = bk ? bkItems.find(x => String(x.product_id) === l.product_id) : P.get(l.product_id); return <div key={i} style={{ background: 'var(--canvas)', borderRadius: 10, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        {l.lot ? <div style={{ gridColumn: 'span 2' }}><div className="lab">Near-expiry lot · non-returnable</div><b>{l.lot.product}</b><br /><span className="code">batch {l.lot.batch_no} · expires {l.lot.expiry_date} · {l.lot.offer.text} · {l.lot.free_boxes} boxes free</span></div>
          : bk ? <div style={{ gridColumn: 'span 2' }}><div className="lab">Product (from booklet)</div><b>{p?.product}</b></div>
          : <div className="fld" style={{ gridColumn: 'span 2' }}><label htmlFor={`ol${i}-p`}>Product *</label><select id={`ol${i}-p`} value={l.product_id} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}><option value="">Select…</option>{prods.map(x => <option key={x.id} value={x.id}>{x.name} {x.pack_size || ''} ({x.code})</option>)}</select></div>}
        <div className="fld"><label htmlFor={`ol${i}-q`}>Boxes{bk && p ? ` (balance ${p.balance})` : ''}</label><input id={`ol${i}-q`} type="number" min={0} value={l.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
        <div><div className="lab">Rate</div><div className="num">{rate(l.product_id, l.lot, l) ? Number(rate(l.product_id, l.lot, l)).toFixed(2) : '–'}</div>{!bk && !l.lot && pricing.rates[l.product_id] && <span className="sub">{pricing.rates[l.product_id].source === 'customer' ? 'Contract rate' : 'Price list'} · trade {P.get(l.product_id)?.trade_rate}</span>}</div>
        <div><div className="lab">Value</div><div className="num">{rs((Number(l.qty) || 0) * upb(l.product_id) * rate(l.product_id, l.lot, l))}</div></div>
        {(() => { const sc = scheme(l); return (sc.got || sc.next) ? <div style={{ gridColumn: '1 / -1' }}>{sc.got && <span className="pill good">Scheme {sc.got.s.code}: {sc.got.s.text}{sc.got.free ? ` · ${sc.got.free} free boxes` : ''}</span>} {sc.next && <span className="pill info">Add {sc.next.more} more {sc.next.more === 1 ? 'box' : 'boxes'} to get {sc.next.text}</span>}</div> : null; })()}
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
  const [box, setBox] = useState(boxes[0]?.[0] || 'all'); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<number | null>(null); const [adding, setAdding] = useState(false); const [flt, setFlt] = useState<Filter>(noFilter); const [init, setInit] = useState<Init | undefined>();
  useEffect(() => { const u = new URLSearchParams(window.location.search); if (canCreate && u.get('customer')) { setInit({ customer: u.get('customer')!, booklet: u.get('booklet') || undefined, repeat: u.get('repeat') === '1', product: u.get('product') || undefined, qty: u.get('qty') || undefined, batch: u.get('batch') || undefined }); setAdding(true); window.history.replaceState(null, '', '/orders'); } }, [canCreate]);
  const load = useCallback(() => call(`/api/orders?box=${box}${filterQuery(flt)}`).then(r => { setRows(r.orders); setErr(''); }).catch(e => setErr(e.message)), [box, flt]);
  useEffect(() => { setRows(null); setOpen(null); load(); }, [load]);
  return (
    <>
      <section className="card"><div className="toolbar"><div className="l">{boxes.map(b => <button key={b[0]} className={`btn ${box === b[0] ? 'primary' : ''}`} onClick={() => { setBox(b[0]); setFlt(noFilter); }}>{b[1]}</button>)}</div>
        <div className="r">{canCreate && !adding && <button className="btn primary" onClick={() => setAdding(true)}>New sales order</button>}</div></div>
        <FilterBar id="od" statuses={['Pending', 'Approved', 'Dispatched', 'Rejected', 'Withdrawn']} value={flt} onChange={setFlt} hint="Search number, customer or person" /></section>
      {adding && <NewOrder init={init} onDone={() => { setAdding(false); setInit(undefined); load(); }} />}
      {err && <div className="errbox" role="alert">{err}</div>}
      {(rows || []).map(o => <OrderCard key={o.id} o={o} open={open === o.id} toggle={() => setOpen(open === o.id ? null : o.id)} onDone={() => { setOpen(null); load(); }} />)}
      {rows && !rows.length && <section className="card"><p className="sub">{flt !== noFilter ? 'No sales order matches these filters.' : 'No sales orders here yet.'}</p></section>}
    </>
  );
}
