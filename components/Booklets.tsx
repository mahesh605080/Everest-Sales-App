'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';
import { CreditBox, Status, Trail, VarPill } from './SalesBits';
import FilterBar, { Filter, filterQuery, noFilter } from './FilterBar';

const blank = () => ({ product_id: '', qty: '10', ask_rate: '', bonus_buy: '', bonus_free: '', discount_pct: '', remarks: '' });
const net = (l: any) => (Number(l.ask_rate) || 0) * (1 - (Number(l.discount_pct) || 0) / 100) * (Number(l.bonus_free) > 0 && Number(l.bonus_buy) > 0 ? Number(l.bonus_buy) / (Number(l.bonus_buy) + Number(l.bonus_free)) : 1);

export function BookletDetail({ id, onDone }: { id: number; onDone: () => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [rm, setRm] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call(`/api/booklets/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  async function act(action: string) { setBusy(true); setErr(''); try { const r = await call(`/api/booklets/${id}`, { method: 'POST', json: { action, remarks: rm } }); toast(r.status === 'Accepted' ? 'Booklet accepted. It can now be used in a sales order.' : r.status === 'Pending' ? `Approved and forwarded to the ${r.level.toUpperCase()}.` : `Booklet ${r.status.toLowerCase()}.`); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  if (!d) return err ? <div className="errbox" role="alert">{err}</div> : <p className="sub">Loading…</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tbl"><table><thead><tr><th>Product</th><th className="r">Boxes</th><th className="r">Balance</th><th className="r">Base rate</th><th className="r">Ask rate</th><th>Bonus</th><th className="r">Disc %</th><th className="r">Net rate</th><th className="r">Below base</th></tr></thead>
        <tbody>{d.items.map((i: any) => <tr key={i.id}><td><b>{i.product}</b><br /><span className="code">{i.product_code} · {i.pack_size || ''} · {i.units_per_box}/box</span>{i.remarks && <><br /><span className="sub">{i.remarks}</span></>}</td>
          <td className="r num">{i.qty}</td><td className="r num">{i.balance}</td><td className="r num">{i.base_rate.toFixed(2)}</td><td className="r num">{i.ask_rate.toFixed(2)}</td><td>{i.bonus_free > 0 ? `${i.bonus_buy}+${i.bonus_free}` : '–'}</td><td className="r num">{i.discount_pct}</td><td className="r num">{i.net_rate.toFixed(2)}</td>
          <td className="r"><VarPill v={i.variance_pct} /></td></tr>)}</tbody></table></div>
      {d.booklet.remarks && <p className="sub">Remarks: {d.booklet.remarks}</p>}
      <CreditBox c={d.credit} />
      {err && <div className="errbox" role="alert">{err}</div>}
      {(d.canDecide || d.canCancel) && <div className="toolbar"><div className="l" style={{ flex: 1 }}><input type="text" id={`bk-rm-${id}`} aria-label="Remarks" placeholder={d.canCancel ? 'Reason for cancelling' : 'Remarks (needed to reject or send back)'} value={rm} onChange={e => setRm(e.target.value)} style={{ flex: 1, minWidth: 200 }} /></div>
        <div className="r">{d.canDecide && <><button className="btn primary" disabled={busy} onClick={() => act('approve')}>Approve</button><button className="btn" disabled={busy} onClick={() => act('back')}>Send back</button><button className="btn danger" disabled={busy} onClick={() => act('reject')}>Reject</button></>}
          {d.canCancel && <button className="btn danger" disabled={busy} onClick={() => act('cancel')}>Cancel booklet</button>}</div></div>}
      <Trail rows={d.trail} />
    </div>
  );
}

function NewBooklet({ onDone, fromId }: { onDone: () => void; fromId?: number | null }) {
  const [custs, setCusts] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]); const [bands, setBands] = useState({ a: 2, r: 5 });
  const [cust, setCust] = useState(''); const [credit, setCredit] = useState<any>(null); const [due, setDue] = useState(new Date(Date.parse(nptToday()) + 7 * 864e5).toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState(''); const [lines, setLines] = useState([blank()]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    call('/api/m/customers?size=500').then(r => setCusts(r.rows)).catch(e => setErr(e.message));
    call('/api/m/products?size=500').then(r => setProds(r.rows)).catch(() => {});
    call('/api/settings').then(r => { const g = (k: string, d: number) => Number(r.settings.find((x: any) => x.key === k)?.value ?? d); setBands({ a: g('booklet_asm_band_pct', 2), r: g('booklet_rsm_band_pct', 5) }); }).catch(() => {});
  }, []);
  // Revising a sent-back booklet starts from its lines; submitting makes a new booklet number.
  useEffect(() => { if (!fromId) return; call(`/api/booklets/${fromId}`).then(r => { setCust(String(r.booklet.customer_id)); setRemarks(r.booklet.remarks || '');
    setLines(r.items.map((i: any) => ({ product_id: String(i.product_id), qty: String(i.qty), ask_rate: String(i.ask_rate), bonus_buy: i.bonus_buy ? String(i.bonus_buy) : '', bonus_free: i.bonus_free ? String(i.bonus_free) : '', discount_pct: i.discount_pct ? String(i.discount_pct) : '', remarks: i.remarks || '' }))); }).catch(e => setErr(e.message)); }, [fromId]);
  useEffect(() => { setCredit(null); if (cust) call(`/api/credit?customer=${cust}`).then(r => setCredit(r.credit)).catch(() => {}); }, [cust]);
  const P = useMemo(() => new Map(prods.map(p => [String(p.id), p])), [prods]);
  const set = (i: number, k: string, v: string) => setLines(ls => ls.map((l, j) => j !== i ? l : { ...l, [k]: v, ...(k === 'product_id' ? { ask_rate: String(P.get(v)?.trade_rate ?? '') } : {}) }));
  const vari = (l: any) => { const b = P.get(l.product_id)?.trade_rate; return b ? (b - net(l)) / b * 100 : 0; };
  const maxV = Math.max(0, ...lines.filter(l => l.product_id).map(vari)), final = maxV <= bands.a ? 'ASM' : maxV <= bands.r ? 'RSM' : 'GM';
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); if (!cust) { setErr('Choose a customer.'); return; }
    setBusy(true);
    try { const r = await call('/api/booklets', { method: 'POST', json: { customer_id: Number(cust), due_date: due, remarks, items: lines.filter(l => l.product_id) } }); toast(`${r.no} sent for approval. Final approver: ${r.final_level.toUpperCase()}.`); onDone(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>{fromId ? 'Revise booklet' : 'New booklet'}</h2>
      <div className="form"><div className="fld"><label htmlFor="bk-cust">Customer *</label><select id="bk-cust" value={cust} onChange={e => setCust(e.target.value)}><option value="">Select…</option>{custs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></div>
        <div className="fld"><label htmlFor="bk-due">Valid to *</label><input id="bk-due" type="date" min={nptToday()} value={due} onChange={e => setDue(e.target.value)} /></div>
        <div className="fld wide"><label htmlFor="bk-rem">Remarks</label><input id="bk-rem" type="text" value={remarks} onChange={e => setRemarks(e.target.value)} /></div></div>
      {credit && <CreditBox c={credit} />}
      {lines.map((l, i) => { const p = P.get(l.product_id), v = vari(l); return <div key={i} style={{ background: 'var(--canvas)', borderRadius: 10, padding: 12, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', alignItems: 'end' }}>
        <div className="fld" style={{ gridColumn: 'span 2' }}><label htmlFor={`bl${i}-p`}>Product *</label><select id={`bl${i}-p`} value={l.product_id} onChange={e => set(i, 'product_id', e.target.value)}><option value="">Select…</option>{prods.map(x => <option key={x.id} value={x.id}>{x.name} {x.pack_size || ''} ({x.code})</option>)}</select></div>
        <div className="fld"><label htmlFor={`bl${i}-q`}>Boxes *</label><input id={`bl${i}-q`} type="number" min={1} value={l.qty} onChange={e => set(i, 'qty', e.target.value)} /></div>
        <div className="fld"><label htmlFor={`bl${i}-a`}>Ask rate{p ? ` (base ${p.trade_rate})` : ''} *</label><input id={`bl${i}-a`} type="number" step="0.01" min={0} value={l.ask_rate} onChange={e => set(i, 'ask_rate', e.target.value)} /></div>
        <div className="fld"><label htmlFor={`bl${i}-b`}>Bonus: buy</label><input id={`bl${i}-b`} type="number" min={0} value={l.bonus_buy} onChange={e => set(i, 'bonus_buy', e.target.value)} /></div>
        <div className="fld"><label htmlFor={`bl${i}-f`}>Bonus: free</label><input id={`bl${i}-f`} type="number" min={0} value={l.bonus_free} onChange={e => set(i, 'bonus_free', e.target.value)} /></div>
        <div className="fld"><label htmlFor={`bl${i}-d`}>Discount %</label><input id={`bl${i}-d`} type="number" min={0} step="0.1" value={l.discount_pct} onChange={e => set(i, 'discount_pct', e.target.value)} /></div>
        <div className="fld" style={{ gridColumn: 'span 2' }}><label htmlFor={`bl${i}-r`}>Reason for this rate{v > 0.005 ? ' *' : ''}</label><input id={`bl${i}-r`} type="text" value={l.remarks} onChange={e => set(i, 'remarks', e.target.value)} /></div>
        <div><div className="lab">Net rate · below base</div><div className="num">{p ? `${net(l).toFixed(2)} · ${v > 0.005 ? v.toFixed(1) + '% below' : 'at or above base'}` : '–'}</div></div>
        {lines.length > 1 && <div><button type="button" className="btn sm" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</button></div>}</div>; })}
      <div className="toolbar"><div className="l"><button type="button" className="btn" onClick={() => setLines(ls => [...ls, blank()])}>Add product</button></div>
        <div className="r"><span className="pill info">Final approver will be {final} · {maxV > 0.005 ? `${maxV.toFixed(1)}% below base` : 'at base rate'}</span></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="toolbar"><div className="l"><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Submit for approval'}</button><button type="button" className="btn" onClick={onDone}>Discard</button></div></div>
    </form>
  );
}

export default function Booklets({ canCreate, canApprove, canAll }: { canCreate: boolean; canApprove: boolean; canAll: boolean }) {
  const boxes = [canApprove && ['inbox', 'To approve'], canCreate && ['mine', 'My booklets'], canAll && ['all', 'All']].filter(Boolean) as string[][];
  const [box, setBox] = useState(boxes[0]?.[0] || 'mine'); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<number | null>(null); const [adding, setAdding] = useState(false); const [revise, setRevise] = useState<number | null>(null); const [flt, setFlt] = useState<Filter>(noFilter);
  const load = useCallback(() => call(`/api/booklets?box=${box}${filterQuery(flt)}`).then(r => { setRows(r.booklets); setErr(''); }).catch(e => setErr(e.message)), [box, flt]);
  useEffect(() => { setRows(null); setOpen(null); load(); }, [load]);
  return (
    <>
      <section className="card"><div className="toolbar"><div className="l">{boxes.map(b => <button key={b[0]} className={`btn ${box === b[0] ? 'primary' : ''}`} onClick={() => { setBox(b[0]); setFlt(noFilter); }}>{b[1]}</button>)}</div>
        <div className="r">{canCreate && !adding && <button className="btn primary" onClick={() => setAdding(true)}>New booklet</button>}</div></div>
        {box !== 'inbox' && <FilterBar id="bk" statuses={['Pending', 'Sent back', 'Accepted', 'Rejected', 'Cancelled', 'Expired']} value={flt} onChange={setFlt} hint="Search number, customer or person" />}</section>
      {adding && <NewBooklet key={revise ?? 'new'} fromId={revise} onDone={() => { setAdding(false); setRevise(null); setBox('mine'); load(); }} />}
      {err && <div className="errbox" role="alert">{err}</div>}
      {(rows || []).map(b => <section className="card" key={b.id}>
        <div className="hd"><div><h2>{b.customer}</h2><span className="code">{b.no} · {b.person} · ordered {b.order_date} · valid to {b.due_date}</span></div>
          <div className="toolbar">{b.status === 'Pending' && <span className="pill info">With {b.level.toUpperCase()} · final {b.final_level.toUpperCase()}</span>}<VarPill v={b.max_variance} /><Status s={b.status} />{canCreate && box === 'mine' && b.status === 'Sent back' && <button className="btn sm primary" onClick={() => { setRevise(b.id); setAdding(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Revise</button>}
            <button className="btn sm" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Close' : 'Open'}</button></div></div>
        {open === b.id && <BookletDetail id={b.id} onDone={() => { setOpen(null); load(); }} />}</section>)}
      {rows && !rows.length && <section className="card"><p className="sub">{box === 'inbox' ? 'Nothing is waiting for your approval.' : flt !== noFilter ? 'No booklet matches these filters.' : 'No booklets here yet.'}</p></section>}
    </>
  );
}
