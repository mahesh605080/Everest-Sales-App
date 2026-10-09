'use client';
import { useEffect, useState } from 'react';
import { call, rs } from '@/lib/ui';

/** The "who should I sell to today" list. `compact` shows the top few on My day. */
export default function Opportunities({ canOrder, compact = false }: { canOrder: boolean; compact?: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { call('/api/sales/opportunities').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return compact ? null : <section className="card"><p className="sub">Looking for opportunities…</p></section>;
  const n = compact ? 3 : 100, none = !d.booklets.length && !d.lapsed.length && !d.reorder.length && !d.expiry.length;
  if (compact && none) return null;
  return <>
    {!compact && <div className="g kpi">
      <div className="card"><div className="lab">Approved rates not yet ordered</div><div className="big">{rs(d.totals.booklet_value)}</div><div className="ctx">{d.booklets.length} booklets with balance</div></div>
      <div className="card"><div className="lab">Customers not ordering</div><div className="big">{d.totals.lapsed}</div><div className="ctx">no order in {d.settings.no_order_days} days</div></div>
      <div className="card"><div className="lab">Reorders due</div><div className="big">{d.totals.reorder}</div><div className="ctx">stock under {d.settings.reorder_cover_days} days</div></div></div>}
    {compact && <section className="card"><div className="hd"><h2>Who to sell to today</h2><a className="btn sm" href="/opportunities">See all</a></div>
      <div className="feed">
        {d.expiry.slice(0, compact ? 2 : n).map((e: any, i: number) => <div key={'e' + i} style={{ alignItems: 'center' }}><div className="t"><b>{e.customer}</b> <span className="pill warn">Near-expiry offer</span><br /><span className="sub">{e.product}, batch {e.batch_no}: {e.offer}, can take {e.can_take} boxes ({rs(e.value)})</span></div>{canOrder && <a className="btn sm primary" href={`/orders?customer=${e.customer_id}&batch=${e.batch_id}&qty=${e.can_take}`}>Order</a>}</div>)}
        {d.booklets.slice(0, n).map((b: any) => <div key={'b' + b.id} style={{ alignItems: 'center' }}><div className="t"><b>{b.customer}</b><br /><span className="sub">Approved rate {b.no}: {rs(b.value_left)} still to order, {b.days_left} days left</span></div>{canOrder && <a className="btn sm primary" href={`/orders?customer=${b.customer_id}&booklet=${b.id}`}>Order</a>}</div>)}
        {d.reorder.slice(0, n).map((r: any, i: number) => <div key={'r' + i} style={{ alignItems: 'center' }}><div className="t"><b>{r.customer}</b><br /><span className="sub">{r.product}: {r.cover_days} days of stock left, suggest {r.suggest_boxes} boxes</span></div>{canOrder && <a className="btn sm primary" href={`/orders?customer=${r.customer_id}&product=${r.product_id}&qty=${r.suggest_boxes}`}>Order</a>}</div>)}
        {d.lapsed.slice(0, n).map((c: any) => <div key={'c' + c.customer_id} style={{ alignItems: 'center' }}><div className="t"><b>{c.customer}</b><br /><span className="sub">{c.last_order ? `No order for ${c.days_since} days` : 'Has never ordered'}</span></div>{canOrder && <a className="btn sm" href={`/orders?customer=${c.customer_id}${c.last_order ? '&repeat=1' : ''}`}>{c.last_order ? 'Repeat' : 'Order'}</a>}</div>)}
      </div></section>}
    {!compact && <>
      {d.expiry.length > 0 && <section className="card" style={{ borderColor: 'var(--warn-fill)' }}><div className="hd"><h2>Near-expiry stock your customers can use in time</h2><a className="btn sm" href="/expiry">Stock and expiry</a></div>
        <div className="tbl"><table><thead><tr><th>Customer</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Offer</th><th className="r">Can take</th><th className="r">Value</th><th></th></tr></thead>
          <tbody>{d.expiry.map((e: any, i: number) => <tr key={i}><td><a href={`/customers/${e.customer_id}`}><b>{e.customer}</b></a></td><td>{e.product}</td><td className="code">{e.batch_no}</td><td><span className="num">{e.expiry_date}</span> <span className={`pill ${e.months_left <= 3 ? 'crit' : 'warn'}`}>{e.months_left} months</span></td>
            <td><span className="pill good">{e.offer}</span><br /><span className="code">Rs {e.rate.toFixed(2)} vs {e.trade_rate.toFixed(2)}</span></td><td className="r num">{e.can_take} boxes</td><td className="r num">{rs(e.value)}</td>
            <td>{canOrder && <a className="btn sm primary" href={`/orders?customer=${e.customer_id}&batch=${e.batch_id}&qty=${e.can_take}`}>Create order</a>}</td></tr>)}</tbody></table></div>
        <p className="sub">These lots have a pre-approved price and are sold as non-returnable. The quantity is what the customer can use before expiry, based on what they buy or report selling each month.</p></section>}
      <section className="card"><div className="hd"><h2>Approved rates waiting for an order</h2><span className="sub">the approval is done; only the order is missing</span></div>
        <div className="tbl"><table><thead><tr><th>Customer</th><th>Booklet</th><th>Sales officer</th><th className="r">Boxes left</th><th className="r">Value left</th><th>Valid for</th><th></th></tr></thead>
          <tbody>{d.booklets.map((b: any) => <tr key={b.id}><td><a href={`/customers/${b.customer_id}`}><b>{b.customer}</b></a></td><td className="code">{b.no}</td><td>{b.person}</td><td className="r num">{b.boxes_left}</td><td className="r num">{rs(b.value_left)}</td>
            <td><span className={`pill ${b.days_left <= 2 ? 'crit' : b.days_left <= 5 ? 'warn' : 'good'}`}>{b.days_left === 0 ? 'ends today' : `${b.days_left} days`}</span></td><td>{canOrder && <a className="btn sm primary" href={`/orders?customer=${b.customer_id}&booklet=${b.id}`}>Create order</a>}</td></tr>)}
            {!d.booklets.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '10px 0' }}>Every accepted booklet has been fully ordered.</p></td></tr>}</tbody></table></div></section>
      <section className="card"><div className="hd"><h2>Distributors running low</h2><span className="sub">from the latest stock reports; suggestion = one month of sale minus stock</span></div>
        <div className="tbl"><table><thead><tr><th>Distributor</th><th>Product</th><th className="r">Stock</th><th className="r">Sold in 30 days</th><th>Cover</th><th className="r">Suggested order</th><th></th></tr></thead>
          <tbody>{d.reorder.map((r: any, i: number) => <tr key={i}><td><a href={`/customers/${r.customer_id}`}><b>{r.customer}</b></a></td><td>{r.product} <span className="code">{r.pack_size || ''}</span></td><td className="r num">{r.stock}</td><td className="r num">{r.sold_30d}</td><td><span className="pill crit">{r.cover_days} days</span></td><td className="r num">{r.suggest_boxes} boxes</td>
            <td>{canOrder && <a className="btn sm primary" href={`/orders?customer=${r.customer_id}&product=${r.product_id}&qty=${r.suggest_boxes}`}>Create order</a>}</td></tr>)}
            {!d.reorder.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '10px 0' }}>No distributor is below {d.settings.reorder_cover_days} days of stock in the latest reports. Reports older than 45 days are ignored.</p></td></tr>}</tbody></table></div></section>
      <section className="card"><div className="hd"><h2>Customers who are not ordering</h2><span className="sub">biggest buyers of the last 12 months first</span></div>
        <div className="tbl"><table><thead><tr><th>Customer</th><th>Type</th><th>Sales officer</th><th>Last order</th><th className="r">Orders, 12 months</th><th className="r">Value, 12 months</th><th></th></tr></thead>
          <tbody>{d.lapsed.map((c: any) => <tr key={c.customer_id}><td><a href={`/customers/${c.customer_id}`}><b>{c.customer}</b></a><br /><span className="code">{c.town || '–'}</span></td><td>{c.type}</td><td>{c.person || '–'}</td>
            <td>{c.last_order ? <><span className="num">{c.last_order}</span> <span className="pill warn">{c.days_since} days ago</span></> : <span className="pill">Never ordered</span>}</td><td className="r num">{c.orders_12m}</td><td className="r num">{rs(c.value_12m)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{canOrder && <>{c.last_order && <a className="btn sm primary" href={`/orders?customer=${c.customer_id}&repeat=1`}>Repeat last order</a>} <a className="btn sm" href={`/orders?customer=${c.customer_id}`}>New order</a></>}</td></tr>)}
            {!d.lapsed.length && <tr><td colSpan={7}><p className="sub" style={{ padding: '10px 0' }}>Every customer has ordered in the last {d.settings.no_order_days} days.</p></td></tr>}</tbody></table></div></section>
    </>}
  </>;
}
