import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { listRows } from '@/lib/crud';
import { q, q1 } from '@/lib/db';
import { ENT } from '@/lib/entities';
import { can } from '@/lib/perm';

const today = () => new Date().toISOString().slice(0, 10);
const KPI = ({ l, v, c }: { l: string; v: any; c: React.ReactNode }) => <div className="card"><div className="lab">{l}</div><div className="big">{v}</div><div className="ctx">{c}</div></div>;
const Bars = ({ rows }: { rows: { name: string; n: number }[] }) => {
  const mx = Math.max(1, ...rows.map(r => r.n));
  return <div className="bars">{rows.map(r => <div key={r.name}><div className="hd"><span>{r.name}</span><span className="num">{r.n}</span></div><div className="b"><i style={{ width: `${r.n / mx * 100}%` }} /></div></div>)}
    {!rows.length && <p className="sub">Nothing to show yet.</p>}</div>;
};

export default async function Dashboard() {
  const s = (await getSession())!;
  const warnDays = Number((await q1<any>(`select value from settings where key='dda_expiry_warning_days'`))?.value || 60);
  const cust = can(s, 'customers.view') ? (await listRows(ENT.customers, s, { size: 5000 })).rows : [];
  const t = today(), soon = new Date(Date.now() + warnDays * 864e5).toISOString().slice(0, 10);
  const expired = cust.filter((c: any) => c.dda_expiry && c.dda_expiry < t);
  const expiring = cust.filter((c: any) => c.dda_expiry && c.dda_expiry >= t && c.dda_expiry <= soon);
  const unassigned = cust.filter((c: any) => !c.assigned_to), noGps = cust.filter((c: any) => c.lat == null || c.lng == null);
  const byType = ['Distributor', 'Hospital', 'Institution', 'Retailer'].map(name => ({ name, n: cust.filter((c: any) => c.type === name).length })).filter(x => x.n);
  const company = s.level >= 4;
  const emp = company ? await q<any>(`select r.name, count(*)::int n from users u join roles r on r.id=u.role_id where u.active group by r.name, r.level order by r.level desc`) : [];
  const byRegion = company ? await q<any>(`select g.name, count(c.id)::int n from regions g left join areas a on a.region_id=g.id left join customers c on c.area_id=a.id and c.active where g.active group by g.name order by g.name`) : [];
  const products = (await q1<any>('select count(*)::int n from products where active'))!.n;
  const recent = can(s, 'audit.view') ? await q<any>(`select user_name, action, entity, entity_id, at from audit_logs where entity<>'auth' order by at desc limit 8`) : [];
  const counts = company ? (await q1<any>(`select (select count(*) from regions where active)::int regions, (select count(*) from areas where active)::int areas, (select count(*) from payment_terms where active)::int terms, (select count(*) from users where active)::int users`))! : null;
  const steps = counts ? [
    ['Regions and areas', counts.regions > 0 && counts.areas > 0, `${counts.regions} regions, ${counts.areas} areas`, '/m/regions'],
    ['Employees with reporting lines', counts.users > 1, `${counts.users} active users`, '/m/employees'],
    ['Products with trade rates', products > 0, `${products} active products`, '/m/products'],
    ['Payment terms', counts.terms > 0, `${counts.terms} terms`, '/m/terms'],
    ['Customers with accounting codes', cust.length > 0, `${cust.length} active customers`, '/m/customers'],
    ['Every customer assigned to a sales officer', cust.length > 0 && !unassigned.length, unassigned.length ? `${unassigned.length} not assigned` : 'All assigned', '/m/customers'],
    ['Every customer has a GPS location', cust.length > 0 && !noGps.length, noGps.length ? `${noGps.length} without location` : 'All located', '/m/customers'],
  ] as [string, boolean, string, string][] : [];

  return (
    <>
      <div className="g kpi">
        <KPI l={company ? 'Customers' : 'My customers'} v={cust.length} c={`${unassigned.length} not assigned to anyone`} />
        {company && <KPI l="Active employees" v={emp.reduce((a: number, x: any) => a + x.n, 0)} c={`${emp.find((x: any) => x.name === 'Sales Officer')?.n || 0} sales officers`} />}
        <KPI l="Products" v={products} c="active in the price list" />
        <KPI l="DDA licence expired" v={expired.length} c={expired.length ? <span className="dn">orders should be held</span> : 'none'} />
        <KPI l={`Expiring in ${warnDays} days`} v={expiring.length} c="follow up for renewal" />
        <KPI l="Without GPS location" v={noGps.length} c="needed for geo-fenced visits" />
      </div>
      <div className="g two">
        <section className="card"><div className="hd"><h2>Customers by type</h2><span className="sub">{company ? 'whole company' : 'your territory'}</span></div><Bars rows={byType} /></section>
        {company ? <section className="card"><div className="hd"><h2>Customers by region</h2></div><Bars rows={byRegion} /></section>
          : <section className="card"><h2>Quick links</h2><div className="feed"><div><div className="t"><Link href="/m/customers">My customers</Link></div></div><div><div className="t"><Link href="/m/products">Price list</Link></div></div>{can(s, 'track.send') && <div><div className="t"><Link href="/location">Share my location</Link></div></div>}</div></section>}
      </div>
      {(expired.length > 0 || expiring.length > 0) && <section className="card"><div className="hd"><h2>DDA licences needing attention</h2></div>
        <div className="tbl"><table><thead><tr><th>Code</th><th>Customer</th><th>Town</th><th>Assigned to</th><th>Licence expiry</th><th>Status</th></tr></thead>
          <tbody>{[...expired, ...expiring].map((c: any) => <tr key={c.id}><td className="code">{c.code}</td><td><b>{c.name}</b></td><td>{c.town}</td><td>{c.assigned_to__label || '–'}</td><td className="num">{c.dda_expiry}</td>
            <td>{c.dda_expiry < t ? <span className="pill crit">Expired</span> : <span className="pill warn">Expiring</span>}</td></tr>)}</tbody></table></div></section>}
      <div className="g two">
        {company && <section className="card"><div className="hd"><h2>Setup checklist</h2><span className="sub">what Phase 2 needs before the field app goes live</span></div>
          <div>{steps.map(x => <div className="check" key={x[0]}><span className={`tick ${x[1] ? 'ok' : ''}`}>{x[1] ? '✓' : ''}</span><div className="t" style={{ flex: 1 }}><b>{x[0]}</b><br /><span className="sub">{x[2]}</span></div><Link className="btn sm" href={x[3]}>Open</Link></div>)}</div></section>}
        {company && <section className="card"><div className="hd"><h2>People by role</h2></div><Bars rows={emp} /></section>}
      </div>
      {recent.length > 0 && <section className="card"><div className="hd"><h2>Recent changes</h2><Link className="btn sm" href="/audit">Audit log</Link></div>
        <div className="feed">{recent.map((r: any, i: number) => <div key={i}><span className="sev info" /><div className="t"><b>{r.user_name || 'System'}</b> {r.action} · {r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</div><time>{new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' })}</time></div>)}</div></section>}
    </>
  );
}
