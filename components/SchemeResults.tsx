'use client';
import { useEffect, useState } from 'react';
import { call, rs } from '@/lib/ui';

export default function SchemeResults({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { call('/api/pricing?results=1').then(r => setRows(r.schemes)).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!rows) return <section className="card"><p className="sub">Loading…</p></section>;
  const run = rows.filter(r => r.running), cost = rows.reduce((a, r) => a + r.cost, 0), value = rows.reduce((a, r) => a + r.value, 0);
  return (
    <>
      <div className="g kpi">
        <section className="card"><div className="lab">Running now</div><div className="big">{run.length}</div><div className="sub">of {rows.length} schemes</div></section>
        <section className="card"><div className="lab">Sold on schemes</div><div className="big">{rs(value)}</div><div className="sub">billed value of scheme lines</div></section>
        <section className="card"><div className="lab">Given away</div><div className="big">{rs(cost)}</div><div className="sub">{value > 0 ? `${(cost / value * 100).toFixed(1)}% of scheme sales` : 'discount plus free boxes at trade rate'}</div></section>
      </div>
      <section className="card">
        <div className="hd"><div><h2>Scheme by scheme</h2><span className="sub">Change in sale compares boxes sold while the scheme ran with the same number of days just before it.</span></div>
          {canEdit && <a className="btn primary" href="/m/schemes">Add or change schemes</a>}</div>
        {!rows.length ? <p className="sub">No scheme has been set up yet.</p> :
          <div className="tbl"><table><thead><tr><th>Scheme</th><th>Product</th><th>Period</th><th className="r">Orders</th><th className="r">Boxes</th><th className="r">Billed</th><th className="r">Given away</th><th className="r">Change in sale</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id}>
              <td><b>{r.name}</b><br /><span className="code">{r.code} · {r.text} · from {r.min_qty} boxes{r.customer_type ? ` · ${r.customer_type} only` : ''}</span></td>
              <td>{r.product}<br /><span className="code">{r.product_code}</span></td>
              <td><span className="num">{r.valid_from} to {r.valid_to}</span><br /><span className={`pill ${r.running ? 'good' : ''}`}>{r.running ? 'Running' : !r.active ? 'Switched off' : r.days > 0 ? 'Ended' : 'Not started'}</span></td>
              <td className="r num">{r.orders}<br /><span className="code">{r.customers} cust.</span></td><td className="r num">{r.boxes}{r.free_boxes > 0 && <><br /><span className="code">+{r.free_boxes} free</span></>}</td><td className="r num">{rs(r.value)}</td>
              <td className="r num">{rs(r.cost)}{r.cost_pct != null && <><br /><span className="code">{r.cost_pct}%</span></>}</td>
              <td className="r">{r.uplift_pct == null ? <span className="sub">{r.before_boxes === 0 && r.during_boxes > 0 ? `${r.during_boxes} boxes, none before` : 'no earlier sale to compare'}</span> : <span className={`pill ${r.uplift_pct > 0 ? 'good' : 'crit'}`}>{r.uplift_pct > 0 ? '+' : ''}{r.uplift_pct}%</span>}<br /><span className="code">{r.before_boxes} → {r.during_boxes} boxes</span></td>
            </tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
