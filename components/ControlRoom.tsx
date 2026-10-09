'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/ui';
import { fmtTime } from '@/lib/geo';

const sh = (n: number) => n >= 1e7 ? 'Rs ' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? 'Rs ' + (n / 1e5).toFixed(1) + ' L' : 'Rs ' + Math.round(n).toLocaleString('en-IN');

function Trend({ d }: { d: any }) {
  const W = 680, H = 230, L = 56, R = 70, T = 14, B = 28, pw = W - L - R, ph = H - T - B, days = d.info.days, upto = Math.max(1, d.info.elapsed);
  const byDay = new Map<number, number>(d.daily.map((x: any) => [+x.day.slice(8), x.value])); const cum: number[] = []; let c = 0;
  for (let i = 1; i <= upto; i++) { c += byDay.get(i) || 0; cum.push(c); }
  const top = Math.max(d.target, c, 1), X = (day: number) => L + (day - 1) / Math.max(1, days - 1) * pw, Y = (v: number) => T + ph - v / top * ph;
  const [hover, setHover] = useState<number | null>(null); const svg = useRef<SVGSVGElement>(null);
  const move = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width); const day = Math.round((x - L) / pw * (days - 1)) + 1; setHover(day >= 1 && day <= upto ? day : null); };
  const mon = new Date(d.info.from + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const ticks = [1, 5, 10, 15, 20, 25, days];
  return <div style={{ position: 'relative' }}>
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Cumulative approved sales against target pace, ${mon}`} style={{ display: 'block' }} onPointerMove={move} onPointerLeave={() => setHover(null)}>
      {[0, .25, .5, .75, 1].map(k => <g key={k}><line x1={L} x2={W - R} y1={Y(top * k)} y2={Y(top * k)} stroke="var(--grid)" /><text x={L - 8} y={Y(top * k) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{k ? sh(top * k).replace('Rs ', '') : '0'}</text></g>)}
      {ticks.map(t => <text key={t} x={X(t)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{t} {mon}</text>)}
      <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} stroke="var(--axis)" />
      {d.target > 0 && <><line x1={X(1)} y1={Y(d.target / days)} x2={X(days)} y2={Y(d.target)} stroke="var(--axis)" strokeWidth="2" strokeDasharray="5 5" /><text x={X(days) + 6} y={Y(d.target) + 4} fontSize="11" fill="var(--ink2)">Target</text></>}
      <path d={`M${X(1)} ${Y(0)} ${cum.map((v, i) => `L${X(i + 1)} ${Y(v)}`).join(' ')} L${X(upto)} ${Y(0)}Z`} fill="var(--accent2)" fillOpacity=".10" />
      <path d={cum.map((v, i) => `${i ? 'L' : 'M'}${X(i + 1)} ${Y(v)}`).join(' ')} fill="none" stroke="var(--accent2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(upto)} cy={Y(c)} r="5" fill="var(--accent2)" stroke="#fff" strokeWidth="2" /><text x={X(upto) + 10} y={Y(c) + 4} fontSize="12" fontWeight="600" fill="var(--ink)">{sh(c)}</text>
      {hover && <g><line x1={X(hover)} x2={X(hover)} y1={T} y2={T + ph} stroke="var(--ink2)" strokeDasharray="3 3" /><circle cx={X(hover)} cy={Y(cum[hover - 1])} r="4" fill="#fff" stroke="var(--accent2)" strokeWidth="2" /></g>}
    </svg>
    {hover && <div style={{ position: 'absolute', left: `${Math.min(72, X(hover) / W * 100)}%`, top: 0, background: 'var(--ink)', color: '#fff', fontSize: 12, padding: '6px 9px', borderRadius: 7, pointerEvents: 'none', whiteSpace: 'nowrap' }}>{hover} {mon} · approved {sh(cum[hover - 1])}{d.target > 0 ? ` · pace needs ${sh(d.target * hover / days)}` : ''}</div>}
    <div className="legend"><span><i style={{ background: 'var(--accent2)' }} />Approved sales (cumulative)</span>{d.target > 0 ? <span><i style={{ background: 'var(--axis)' }} />Pace needed for target</span> : <span>No targets set for this month</span>}</div>
  </div>;
}

export default function ControlRoom() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { const load = () => call('/api/perf?view=overview').then(setD).catch(e => setErr(e.message)); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (err) return <div className="errbox" role="alert">{err}</div>;
  if (!d) return <section className="card"><p className="sub">Loading the control room…</p></section>;
  const ach = d.target > 0 ? d.sales / d.target : null, pace = d.info.pace, gap = ach == null ? null : Math.round((ach - pace) * 100);
  const w = d.waiting, waiting = w.booklets + w.orders + w.expenses + w.leave + w.plans, mx = Math.max(pace, ...d.regions.map((r: any) => r.target > 0 ? r.sales / r.target : 0)) * 1.25 || 1;
  const K = ({ l, v, c }: any) => <div className="card"><div className="lab">{l}</div><div className="big">{v}</div><div className="ctx">{c}</div></div>;
  return <>
    <div className="g kpi">
      <K l="Month sales" v={sh(d.sales)} c={ach == null ? 'no targets set' : <>{Math.round(ach * 100)}% of {sh(d.target)} · <span className={gap! >= 0 ? 'up' : 'dn'}>{gap! >= 0 ? '+' : ''}{gap} pts vs pace</span></>} />
      <K l="On duty today" v={`${d.today.present} / ${d.team}`} c={<Link href="/team">open Team today</Link>} />
      <K l="Visits today" v={d.today.visits} c={<Link href="/visits">visit report</Link>} />
      <K l="Collection" v={sh(d.collection)} c="recorded this month" />
      <K l="Open alerts" v={d.today.alerts} c={d.today.crit ? <span className="dn">{d.today.crit} critical</span> : <Link href="/alerts">see alerts</Link>} />
      <K l="Waiting for a decision" v={waiting} c={`${w.booklets} booklets · ${w.orders} orders · ${w.expenses + w.leave + w.plans} other`} />
    </div>
    {d.pipeline && <section className="card"><div className="hd"><h2>Sales pipeline</h2><Link className="btn sm" href="/opportunities">Sales opportunities</Link></div>
      <div className="pipe">
        {[['Booklets in approval', d.pipeline.bk_pending, sh(d.pipeline.bk_pending_value), '/booklets', d.pipeline.hours_to_accept != null ? `${d.pipeline.hours_to_accept} h average to accept` : ''],
          ['Orders with Credit Control', d.pipeline.so_pending, sh(d.pipeline.so_pending_value), '/orders', d.pipeline.hours_to_approve != null ? `${d.pipeline.hours_to_approve} h average to approve` : ''],
          ['Approved, to dispatch', d.pipeline.so_approved, sh(d.pipeline.so_approved_value), '/orders', d.pipeline.hours_to_dispatch != null ? `${d.pipeline.hours_to_dispatch} h average to dispatch` : ''],
          ['Dispatched this month', d.pipeline.so_dispatched, sh(d.pipeline.so_dispatched_value), '/orders', d.pipeline.so_rejected ? `${d.pipeline.so_rejected} rejected this month` : '']].map((x: any, i: number) =>
          <Link key={i} href={x[3]} className="pstep"><span className="lab">{x[0]}</span><b className="big" style={{ fontSize: 22 }}>{x[1]}</b><span className="num">{x[2]}</span><span className="sub">{x[4]}</span></Link>)}
      </div></section>}
    <div className="g two">
      <section className="card"><div className="hd"><h2>Sales against target pace</h2><span className="sub">day {d.info.elapsed} of {d.info.days}</span></div><Trend d={d} /></section>
      <section className="card"><div className="hd"><h2>Achievement by region</h2></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{d.regions.map((r: any) => { const p = r.target > 0 ? r.sales / r.target : 0; return <div key={r.name} title={`${r.name}: ${sh(r.sales)} of ${sh(r.target)}`}>
          <div className="hd"><span>{r.name}</span><span className="num">{r.target > 0 ? Math.round(p * 100) + '%' : 'no target'}</span></div>
          <div style={{ position: 'relative', height: 14, background: 'var(--sunk)', borderRadius: 4 }}><div style={{ height: '100%', width: `${Math.min(100, p / mx * 100)}%`, background: 'var(--accent2)', borderRadius: '0 4px 4px 0' }} /><div style={{ position: 'absolute', top: -3, bottom: -3, left: `${pace / mx * 100}%`, width: 2, background: 'var(--ink)' }} /></div></div>; })}
          <div className="legend"><span><i style={{ background: 'var(--accent2)' }} />% of month target</span><span><i style={{ background: 'var(--ink)', width: 2, borderRadius: 0 }} />Pace today ({Math.round(pace * 100)}%)</span></div></div></section>
    </div>
    <div className="g two">
      <section className="card"><div className="hd"><h2>Latest alerts</h2><Link className="btn sm" href="/alerts">See all</Link></div>
        <div className="feed">{d.alerts.map((a: any, i: number) => <div key={i}><span className={`sev ${a.severity}`} /><div className="t"><b>{a.person || 'System'}</b><br />{a.message}</div><time>{fmtTime(a.at)}</time></div>)}{!d.alerts.length && <p className="sub">No open alerts.</p>}</div></section>
      <section className="card"><div className="hd"><h2>Top and bottom scores</h2><Link className="btn sm" href="/scorecard">Scorecard</Link></div>
        <div className="feed">{[...d.ranked.slice(0, 3), ...(d.ranked.length > 6 ? d.ranked.slice(-3) : d.ranked.slice(3))].map((r: any, i: number) => <div key={r.id} style={{ alignItems: 'center' }}><div className="av">{r.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div><div className="t"><b>{r.name}</b><br /><span className="code">{r.area || '–'}</span></div><span className={`pill ${i < 3 && r.score >= 60 ? 'good' : r.score >= 60 ? 'info' : 'crit'}`}>{r.score}</span></div>)}</div></section>
    </div>
  </>;
}
