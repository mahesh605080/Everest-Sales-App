import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreditBox, Status, VarPill } from '@/components/SalesBits';
import { getSession } from '@/lib/auth';
import { customer360 } from '@/lib/customer360';
import { can } from '@/lib/perm';

const rs = (n: any) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const t = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
const Empty = ({ what }: { what: string }) => <p className="sub">No {what} yet.</p>;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s || !can(s, 'customers.view')) notFound();
  let d: any; try { d = await customer360(s, Number((await params).id)); } catch { notFound(); }
  const c = d.customer, K = ({ l, v, sub }: any) => <div className="card"><div className="lab">{l}</div><div className="big" style={{ fontSize: 21 }}>{v}</div><div className="ctx">{sub}</div></div>;
  return (
    <>
      <section className="card">
        <div className="hd"><div><h2 style={{ fontSize: 19 }}>{c.name}</h2><span className="code">{c.code} · {c.type} · {c.town || 'no town'}{c.area_id__label ? ` · ${c.area_id__label}` : ''}</span></div>
          <div className="toolbar">{!c.active && <span className="pill">Inactive</span>}<span className="pill info">{c.assigned_to__label ? `Assigned to ${c.assigned_to__label}` : 'Not assigned'}</span>{can(s, 'orders.create') && c.active && <><a className="btn sm primary" href={`/orders?customer=${c.id}`}>New order</a><a className="btn sm" href={`/orders?customer=${c.id}&repeat=1`}>Repeat last order</a><a className="btn sm" href={`/booklets?customer=${c.id}`}>Ask special rate</a></>}{c.lat != null && <Link className="btn sm" href="/map">On the map</Link>}<Link className="btn sm" href="/m/customers">All customers</Link></div></div>
        <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          <div><div className="lab">Contact</div>{c.contact_person || '–'} {c.phone || ''}</div><div><div className="lab">Address</div>{c.address || '–'}</div>
          <div><div className="lab">Payment term</div>{c.payment_term_id__label || '–'}</div><div><div className="lab">PAN / VAT</div><span className="num">{c.pan_vat || '–'}</span></div>
          <div><div className="lab">DDA licence</div><span className="num">{c.dda_licence_no || '–'}{c.dda_expiry ? ` · to ${c.dda_expiry}` : ''}</span></div></div>
      </section>
      <div className="g kpi">
        <K l="Sales, 12 months" v={rs(d.totals.sales_12m)} sub="approved orders" /><K l="Collected, 12 months" v={rs(d.totals.collected_12m)} sub="verified collections" />
        <K l="Visits, 90 days" v={d.totals.visits_90d} sub={d.totals.last_visit ? `last on ${d.totals.last_visit}` : 'never visited'} /><K l="Available credit" v={rs(d.credit.available)} sub={`limit ${rs(d.credit.credit_limit)}`} />
      </div>
      <section className="card">
        <div className="hd"><div><h2>Selling to this customer</h2><span className="sub">class by 12-month sales, what it can still return, its rates and the schemes running today</span></div>
          <div className="toolbar"><span className={`pill ${d.selling.cls === 'A' ? 'good' : d.selling.cls === 'B' ? 'info' : ''}`}>Class {d.selling.cls} · visit every {d.selling.norm_days} days</span></div></div>
        <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div><div className="lab">Expiry returns allowance</div><b className="num">{rs(d.selling.allowance.left)}</b> left<br /><span className="sub">{rs(d.selling.allowance.returned)} returned of {rs(d.selling.allowance.allowed)} allowed ({d.selling.allowance.cap_pct}% of 12-month purchases)</span></div>
          {d.selling.rebate && <div><div className="lab">Yearly rebate</div>{d.selling.rebate.pct ? <b className="num">{d.selling.rebate.pct}% earned</b> : <span>no slab reached yet</span>}<br /><span className="sub">{rs(d.selling.rebate.bought)} bought this fiscal year{d.selling.rebate.gap != null ? ` · ${rs(d.selling.rebate.gap)} more for ${d.selling.rebate.next_pct}%` : ' · top slab reached'}</span></div>}
          <div><div className="lab">Own rates</div>{d.selling.rates.length ? d.selling.rates.map((r: any, i: number) => <div key={i}>{r.product}: <b className="num">{Number(r.rate).toFixed(2)}</b> <span className="code">{r.source === 'customer' ? 'contract' : 'price list'} · trade {r.trade_rate}</span></div>) : <span className="sub">Buys at the trade rate.</span>}</div>
          <div><div className="lab">Schemes running</div>{d.selling.schemes.length ? d.selling.schemes.map((x: any) => <div key={x.code}>{x.product}: <span className="pill good">{x.text}</span> <span className="code">from {x.min_qty} boxes · to {x.valid_to}</span></div>) : <span className="sub">No scheme is running for this customer.</span>}</div>
        </div>
      </section>
      <section className="card"><h2>Credit position</h2><CreditBox c={d.credit} /></section>
      <div className="g two">
        <section className="card"><h2>Sales orders</h2>{d.orders.length ? <div className="tbl"><table><thead><tr><th>Order</th><th>Date</th><th>By</th><th className="r">Value</th><th>Status</th></tr></thead>
          <tbody>{d.orders.map((o: any) => <tr key={o.id}><td className="code"><a href={`/print/order/${o.id}`} target="_blank" rel="noreferrer">{o.no}</a></td><td className="num">{o.order_date}</td><td>{o.person}</td><td className="r num">{rs(o.value)}</td><td><Status s={o.status} /></td></tr>)}</tbody></table></div> : <Empty what="sales orders" />}</section>
        <section className="card"><h2>Booklets</h2>{d.booklets.length ? <div className="tbl"><table><thead><tr><th>Booklet</th><th>Valid to</th><th>Rate</th><th>Status</th></tr></thead>
          <tbody>{d.booklets.map((b: any) => <tr key={b.id}><td className="code">{b.no}</td><td className="num">{b.due_date}</td><td><VarPill v={b.max_variance} /></td><td><Status s={b.status} /></td></tr>)}</tbody></table></div> : <Empty what="booklets" />}</section>
      </div>
      <section className="card"><h2>Visits</h2>{d.visits.length ? <div className="tbl"><table><thead><tr><th>Date</th><th>Time</th><th>By</th><th>Location</th><th>Purpose</th><th>Person met</th><th>Remarks</th></tr></thead>
        <tbody>{d.visits.map((v: any, i: number) => <tr key={i}><td className="num">{v.day}</td><td className="num">{t(v.in_at)}</td><td>{v.person}</td><td>{v.out_of_fence ? <span className="pill crit">{v.distance_m} m away</span> : <span className="pill good">At location</span>}</td><td>{v.purpose || '–'}</td><td>{v.person_met || '–'}</td><td style={{ maxWidth: 320 }}>{v.remarks || '–'}</td></tr>)}</tbody></table></div> : <Empty what="visits" />}</section>
      <div className="g two">
        <section className="card"><h2>Collections</h2>{d.collections.length ? <div className="tbl"><table><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th className="r">Amount</th><th>Status</th></tr></thead>
          <tbody>{d.collections.map((k: any, i: number) => <tr key={i}><td className="num">{k.day}</td><td>{k.mode}</td><td className="code">{k.ref_no || '–'}</td><td className="r num">{rs(k.amount)}</td><td><span className={`pill ${k.status === 'Verified' ? 'good' : k.status === 'Rejected' ? 'crit' : 'warn'}`}>{k.status}</span></td></tr>)}</tbody></table></div> : <Empty what="collections" />}</section>
        <section className="card"><h2>Claims</h2>{d.claims.length ? <div className="tbl"><table><thead><tr><th>Date</th><th>Type</th><th>Product</th><th className="r">Amount</th><th>Status</th></tr></thead>
          <tbody>{d.claims.map((k: any, i: number) => <tr key={i}><td className="num">{k.day}</td><td>{k.type}</td><td>{k.product || '–'}</td><td className="r num">{rs(k.amount)}</td><td><span className="pill">{k.status}</span></td></tr>)}</tbody></table></div> : <Empty what="claims" />}</section>
      </div>
      <div className="g two">
        <section className="card"><h2>Latest stock report{d.stock[0] ? ` (${d.stock[0].day})` : ''}</h2>{d.stock.length ? <div className="tbl"><table><thead><tr><th>Product</th><th className="r">Stock</th><th className="r">Sold in 30 days</th><th className="r">Near expiry</th></tr></thead>
          <tbody>{d.stock.map((x: any, i: number) => <tr key={i}><td>{x.product}</td><td className="r num">{x.stock}</td><td className="r num">{x.sold_30d}</td><td className="r num">{x.near_expiry || '–'}</td></tr>)}</tbody></table></div> : <Empty what="stock report" />}</section>
        <section className="card"><h2>Who has looked after this customer</h2>{d.history.length ? <div className="feed">{d.history.map((h: any, i: number) => <div key={i}><div className="t"><b>{h.person}</b></div><time>{h.from_date} to {h.to_date || 'now'}</time></div>)}</div> : <Empty what="assignment" />}</section>
      </div>
    </>
  );
}
