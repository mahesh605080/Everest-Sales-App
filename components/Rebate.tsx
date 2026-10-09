'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';

export default function Rebate({ canManage, canOrder }: { canManage: boolean; canOrder: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [edit, setEdit] = useState<any[] | null>(null);
  const load = useCallback(() => call('/api/rebate').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function save() { setErr(''); try { await call('/api/rebate', { method: 'PUT', json: { slabs: edit } }); toast('Rebate slabs saved.'); setEdit(null); load(); } catch (e: any) { setErr(e.message); } }
  if (!d) return err ? <div className="errbox" role="alert">{err}</div> : <section className="card"><p className="sub">Loading…</p></section>;
  return <>
    <section className="card"><div className="hd"><div><h2>Yearly volume rebate · fiscal year {d.fy.slice(0, 2)}/{d.fy.slice(2)}</h2><span className="sub">A distributor whose approved purchases since {d.fy_start} reach a slab earns that percentage on the whole year's value.</span></div>
      {canManage && !edit && <button className="btn" onClick={() => setEdit(d.slabs.length ? d.slabs.map((x: any) => ({ from_value: String(x.from), pct: String(x.pct) })) : [{ from_value: '', pct: '' }])}>{d.slabs.length ? 'Change slabs' : 'Set slabs'}</button>}</div>
      {!edit && (d.slabs.length ? <div className="toolbar"><div className="l">{d.slabs.map((x: any) => <span className="pill info" key={x.from}>{rs(x.from)} and above: {x.pct}%</span>)}</div></div> : <p className="sub">No rebate slab has been set{canManage ? '. Set the slabs to start.' : ' yet.'}</p>)}
      {edit && <><div className="tbl"><table><thead><tr><th>Purchases in the year from (Rs)</th><th>Rebate %</th><th /></tr></thead>
        <tbody>{edit.map((r, i) => <tr key={i}><td><input type="number" min={0} aria-label={`Slab ${i + 1} purchases`} value={r.from_value} onChange={e => setEdit(x => x!.map((y, j) => j === i ? { ...y, from_value: e.target.value } : y))} /></td>
          <td><input type="number" min={0} step="0.25" aria-label={`Slab ${i + 1} rebate`} value={r.pct} onChange={e => setEdit(x => x!.map((y, j) => j === i ? { ...y, pct: e.target.value } : y))} style={{ width: 100 }} /></td>
          <td><button className="btn sm" onClick={() => setEdit(x => x!.filter((_, j) => j !== i))}>Remove</button></td></tr>)}</tbody></table></div>
        <div className="toolbar"><div className="l"><button className="btn" onClick={() => setEdit(x => [...x!, { from_value: '', pct: '' }])}>Add slab</button></div><div className="r"><button className="btn primary" onClick={save}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div></div></>}
      {err && <div className="errbox" role="alert">{err}</div>}</section>
    {d.slabs.length > 0 && <>
      <div className="g kpi">
        <div className="card"><div className="lab">Bought this year</div><div className="big">{rs(d.bought)}</div><div className="ctx">{d.rows.length} distributors</div></div>
        <div className="card"><div className="lab">Rebate earned so far</div><div className="big">{rs(d.earned)}</div><div className="ctx">{d.bought > 0 ? `${(d.earned / d.bought * 100).toFixed(2)}% of purchases` : 'no purchases yet'}</div></div>
        <div className="card"><div className="lab">Close to the next slab</div><div className="big">{d.rows.filter((r: any) => r.gap != null && r.gap <= r.next_from * 0.2).length}</div><div className="ctx">within 20% of it: the easiest extra sale</div></div>
      </div>
      <section className="card"><div className="hd"><h2>Distributor by distributor</h2><span className="sub">closest to the next slab first</span></div>
        <div className="tbl"><table><thead><tr><th>Distributor</th><th className="r">Bought this year</th><th>Slab now</th><th className="r">Earned</th><th>To reach the next slab</th><th /></tr></thead>
          <tbody>{d.rows.map((r: any) => <tr key={r.id}><td><a href={`/customers/${r.id}`}><b>{r.name}</b></a><br /><span className="code">{r.town || '–'} · {r.person || 'not assigned'}</span></td><td className="r num">{rs(r.bought)}</td>
            <td>{r.pct ? <span className="pill good">{r.pct}%</span> : <span className="code">none yet</span>}</td><td className="r num">{rs(r.earned)}</td>
            <td>{r.gap == null ? <span className="pill good">top slab reached</span> : <><b className="num">{rs(r.gap)}</b> more for {r.next_pct}%<br /><span className="code">rebate becomes {rs(r.next_earned)}</span>
              <div style={{ height: 6, background: 'var(--sunk)', borderRadius: 3, marginTop: 4 }}><div style={{ height: '100%', width: `${Math.min(100, r.bought / r.next_from * 100)}%`, background: 'var(--accent2)', borderRadius: 3 }} /></div></>}</td>
            <td>{canOrder && r.gap != null && <a className="btn sm primary" href={`/orders?customer=${r.id}`}>New order</a>}</td></tr>)}</tbody></table></div></section></>}
  </>;
}
