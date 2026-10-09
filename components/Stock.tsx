'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';

function Report({ onSaved }: { onSaved: () => void }) {
  const [custs, setCusts] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]); const [cust, setCust] = useState(''); const [last, setLast] = useState<string | null>(null);
  const [v, setV] = useState<Record<number, { stock: string; sold_30d: string; near_expiry: string }>>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { call('/api/m/customers?size=500').then(r => setCusts(r.rows.filter((c: any) => c.type === 'Distributor'))).catch(e => setErr(e.message)); call('/api/m/products?size=500').then(r => setProds(r.rows)).catch(() => {}); }, []);
  useEffect(() => { setV({}); setLast(null); if (!cust) return; call(`/api/stock?customer=${cust}`).then(r => { setLast(r.last_day); setV(Object.fromEntries(r.items.map((i: any) => [i.product_id, { stock: String(i.stock), sold_30d: String(i.sold_30d), near_expiry: String(i.near_expiry) }]))); }).catch(e => setErr(e.message)); }, [cust]);
  const set = (pid: number, k: string, x: string) => setV(o => ({ ...o, [pid]: { stock: '', sold_30d: '', near_expiry: '', ...o[pid], [k]: x } }));
  async function save() { setBusy(true); setErr(''); try { await call('/api/stock', { method: 'POST', json: { customer_id: Number(cust), items: Object.entries(v).map(([p, x]) => ({ product_id: Number(p), ...x })) } }); toast('Stock report saved for today.'); onSaved(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  return <section className="card"><h2>Report distributor stock</h2>
    <div className="toolbar"><div className="l"><label className="user" htmlFor="st-cust">Distributor <select id="st-cust" value={cust} onChange={e => setCust(e.target.value)}><option value="">Select…</option>{custs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></label>
      {cust && <span className="sub">{last ? `last report ${last}; its figures are filled in below` : 'no earlier report'}</span>}</div><div className="r">{cust && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save report'}</button>}</div></div>
    {err && <div className="errbox" role="alert">{err}</div>}
    {cust && <div className="tbl"><table><thead><tr><th>Product</th><th className="r">Stock (boxes)</th><th className="r">Sold in last 30 days</th><th className="r">Near expiry (boxes)</th></tr></thead>
      <tbody>{prods.map(p => <tr key={p.id}><td><b>{p.name}</b><br /><span className="code">{p.code} · {p.pack_size || ''}</span></td>
        {(['stock', 'sold_30d', 'near_expiry'] as const).map(k => <td key={k} className="r"><input type="number" min={0} aria-label={`${p.name}: ${k}`} value={v[p.id]?.[k] ?? ''} onChange={e => set(p.id, k, e.target.value)} style={{ width: 96, textAlign: 'right' }} /></td>)}</tr>)}</tbody></table></div>}
  </section>;
}

function Health() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [only, setOnly] = useState('problem');
  useEffect(() => { call('/api/stock?view=health').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Loading…</p></section>;
  const list = d.rows.filter((r: any) => only === 'all' || (only === 'problem' ? r.status !== 'Healthy' : r.status === only));
  const excess = d.rows.reduce((a: number, r: any) => a + r.excess_value, 0), pill = (st: string) => st === 'Healthy' ? 'good' : st === 'Running low' ? 'crit' : 'warn';
  return <>
    <div className="g kpi">
      <div className="card"><div className="lab">Stock above {d.max_cover_months} months of sale</div><div className="big" style={{ color: excess > 0 ? 'var(--crit)' : undefined }}>{rs(excess)}</div><div className="ctx">at trade rate · likely to return as expiry</div></div>
      <div className="card"><div className="lab">Piling up</div><div className="big">{d.rows.filter((r: any) => r.status === 'Piling up').length}</div><div className="ctx">buying faster than selling</div></div>
      <div className="card"><div className="lab">Running low</div><div className="big">{d.rows.filter((r: any) => r.status === 'Running low').length}</div><div className="ctx">under {d.low_days} days of sale · order now</div></div>
    </div>
    <section className="card"><div className="toolbar"><div className="l"><h2>Bought from us against sold to the market</h2></div>
      <div className="r"><label className="user" htmlFor="ch-only">Show <select id="ch-only" value={only} onChange={e => setOnly(e.target.value)}><option value="problem">Needs attention</option><option>Piling up</option><option>Overstocked</option><option>Running low</option><option>Not selling</option><option value="all">Everything</option></select></label></div></div>
      <div className="tbl"><table><thead><tr><th>Distributor</th><th>Product</th><th className="r">Buys / month</th><th className="r">Sells / month</th><th className="r">Stock</th><th className="r">Months of sale</th><th>Status</th><th className="r">Extra stock</th></tr></thead>
        <tbody>{list.map((r: any, i: number) => <tr key={i}><td><a href={`/customers/${r.customer_id}`}><b>{r.customer}</b></a><br /><span className="code">{r.town || '–'} · reported {r.day}</span></td><td>{r.product}<br /><span className="code">{r.product_code}</span></td>
          <td className="r num">{r.bought_pm}</td><td className="r num">{r.sold_30d}</td><td className="r num">{r.stock}{r.coming > 0 && <><br /><span className="code">+{r.coming} on order</span></>}</td><td className="r num">{r.cover_months ?? '–'}</td>
          <td><span className={`pill ${pill(r.status)}`}>{r.status}</span></td><td className="r num">{r.excess > 0 ? <>{r.excess} boxes<br /><span className="code">{rs(r.excess_value)}</span></> : '–'}</td></tr>)}
          {!list.length && <tr><td colSpan={8}><p className="sub" style={{ padding: '12px 0' }}>{d.rows.length ? 'Nothing matches this filter.' : 'No stock report in the last 45 days.'}</p></td></tr>}</tbody></table></div>
      <p className="sub">"Buys" is the monthly average of approved orders in the last 90 days; "sells" is what the distributor sold in the 30 days before its last stock report.</p></section>
  </>;
}

function Transfers({ canOrder }: { canOrder: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { call('/api/stock?view=transfers').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Loading…</p></section>;
  return <section className="card"><div className="hd"><div><h2>Move stock between distributors</h2><span className="sub">One distributor cannot sell it in time, another is running short of the same product. Moving it saves an expiry return and a lost sale.</span></div>
    {d.rows.length > 0 && <b className="num">{rs(d.rows.reduce((a: number, r: any) => a + r.value, 0))}</b>}</div>
    {!d.rows.length ? <p className="sub">No match right now. A match needs stock reports from both distributors in the last 45 days.</p> :
      <div className="tbl"><table><thead><tr><th>Product</th><th>From</th><th>To</th><th className="r">Boxes</th><th className="r">Value</th><th /></tr></thead>
        <tbody>{d.rows.map((r: any, i: number) => <tr key={i}><td><b>{r.product}</b></td>
          <td><a href={`/customers/${r.from_id}`}>{r.from}</a><br /><span className="code">{r.from_town || '–'} · {r.reason}</span></td>
          <td><a href={`/customers/${r.to_id}`}>{r.to}</a><br /><span className="code">{r.to_town || '–'} · {r.to_cover_days} days of stock left · {r.near}</span></td>
          <td className="r num">{r.boxes}</td><td className="r num">{rs(r.value)}</td>
          <td>{canOrder && <a className="btn sm" href={`/orders?customer=${r.to_id}&product=${r.product_id}&qty=${r.boxes}`}>Or sell fresh</a>}</td></tr>)}</tbody></table></div>}</section>;
}

export default function Stock({ canReport, canView, canOrder }: { canReport: boolean; canView: boolean; canOrder: boolean }) {
  const [tab, setTab] = useState('latest');
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [only, setOnly] = useState('all');
  const load = useCallback(() => { if (canView) call('/api/stock').then(r => setRows(r.rows)).catch(e => setErr(e.message)); }, [canView]);
  useEffect(() => { load(); }, [load]);
  const kind = (r: any) => r.cover_days == null ? (r.stock > 0 ? 'No sale' : '') : r.cover_days < 15 ? 'Reorder' : r.cover_days > 90 ? 'Overstock' : 'Healthy';
  const list = (rows || []).filter(r => only === 'all' || (only === 'exp' ? r.near_expiry > 0 : kind(r) === only));
  return <>
    {canView && <section className="card"><div className="toolbar"><div className="l">{[['latest', 'Stock reports'], ['health', 'Bought vs sold'], ['move', 'Move stock']].map(t => <button key={t[0]} className={`btn ${tab === t[0] ? 'primary' : ''}`} onClick={() => setTab(t[0])}>{t[1]}</button>)}</div></div></section>}
    {canView && tab === 'health' && <Health />}
    {canView && tab === 'move' && <Transfers canOrder={canOrder} />}
    {canReport && tab === 'latest' && <Report onSaved={load} />}
    {canView && tab === 'latest' && <section className="card"><div className="toolbar"><div className="l"><h2>Latest stock at distributors</h2></div>
      <div className="r"><label className="user" htmlFor="st-only">Show <select id="st-only" value={only} onChange={e => setOnly(e.target.value)}><option value="all">Everything</option><option value="Reorder">Under 15 days of cover</option><option value="Overstock">Over 90 days of cover</option><option value="No sale">Stock but no sale</option><option value="exp">Near expiry</option></select></label></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="tbl"><table><thead><tr><th>Distributor</th><th>Product</th><th className="r">Stock</th><th className="r">Sold in 30 days</th><th>Days of cover</th><th className="r">Near expiry</th><th>Reported</th></tr></thead>
        <tbody>{list.map((r, i) => { const k = kind(r); return <tr key={i}><td><b>{r.customer}</b><br /><span className="code">{r.customer_code} · {r.town || '–'}</span></td><td>{r.product}<br /><span className="code">{r.product_code}</span></td><td className="r num">{r.stock}</td><td className="r num">{r.sold_30d}</td>
          <td>{k ? <span className={`pill ${k === 'Reorder' ? 'crit' : k === 'Healthy' ? 'good' : 'warn'}`}>{r.cover_days != null ? `${r.cover_days} days · ` : ''}{k}</span> : <span className="code">–</span>}</td><td className="r num">{r.near_expiry || '–'}</td><td className="code">{r.day} · {r.person}</td></tr>; })}
          {rows && !list.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '12px 0' }}>{rows.length ? 'Nothing matches this filter.' : 'No stock has been reported yet.'}</p></td></tr>}</tbody></table></div></section>}
  </>;
}
