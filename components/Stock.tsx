'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';

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

export default function Stock({ canReport, canView }: { canReport: boolean; canView: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [only, setOnly] = useState('all');
  const load = useCallback(() => { if (canView) call('/api/stock').then(r => setRows(r.rows)).catch(e => setErr(e.message)); }, [canView]);
  useEffect(() => { load(); }, [load]);
  const kind = (r: any) => r.cover_days == null ? (r.stock > 0 ? 'No sale' : '') : r.cover_days < 15 ? 'Reorder' : r.cover_days > 90 ? 'Overstock' : 'Healthy';
  const list = (rows || []).filter(r => only === 'all' || (only === 'exp' ? r.near_expiry > 0 : kind(r) === only));
  return <>
    {canReport && <Report onSaved={load} />}
    {canView && <section className="card"><div className="toolbar"><div className="l"><h2>Latest stock at distributors</h2></div>
      <div className="r"><label className="user" htmlFor="st-only">Show <select id="st-only" value={only} onChange={e => setOnly(e.target.value)}><option value="all">Everything</option><option value="Reorder">Under 15 days of cover</option><option value="Overstock">Over 90 days of cover</option><option value="No sale">Stock but no sale</option><option value="exp">Near expiry</option></select></label></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="tbl"><table><thead><tr><th>Distributor</th><th>Product</th><th className="r">Stock</th><th className="r">Sold in 30 days</th><th>Days of cover</th><th className="r">Near expiry</th><th>Reported</th></tr></thead>
        <tbody>{list.map((r, i) => { const k = kind(r); return <tr key={i}><td><b>{r.customer}</b><br /><span className="code">{r.customer_code} · {r.town || '–'}</span></td><td>{r.product}<br /><span className="code">{r.product_code}</span></td><td className="r num">{r.stock}</td><td className="r num">{r.sold_30d}</td>
          <td>{k ? <span className={`pill ${k === 'Reorder' ? 'crit' : k === 'Healthy' ? 'good' : 'warn'}`}>{r.cover_days != null ? `${r.cover_days} days · ` : ''}{k}</span> : <span className="code">–</span>}</td><td className="r num">{r.near_expiry || '–'}</td><td className="code">{r.day} · {r.person}</td></tr>; })}
          {rows && !list.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '12px 0' }}>{rows.length ? 'Nothing matches this filter.' : 'No stock has been reported yet.'}</p></td></tr>}</tbody></table></div></section>}
  </>;
}
