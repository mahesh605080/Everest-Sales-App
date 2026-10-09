'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/ui';
import { fmtTime, nptToday } from '@/lib/geo';

const status = (p: any): [string, string] => p.at_customer ? [`On visit: ${p.at_customer}`, 'good'] : p.visits > 0 ? ['Visited today', 'info'] : ['No visit yet', 'warn'];

export default function Team() {
  const [day, setDay] = useState(nptToday()); const [people, setPeople] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const isToday = day === nptToday();
  const load = useCallback(() => call(`/api/team/today?day=${day}`).then(r => { setPeople(r.people); setErr(''); }).catch(e => setErr(e.message)), [day]);
  useEffect(() => { load(); if (!isToday) return; const t = setInterval(load, 30000); return () => clearInterval(t); }, [load, isToday]);
  const p = people || [], active = p.filter(x => x.visits > 0);
  const K = ({ l, v, c }: any) => <div className="card"><div className="lab">{l}</div><div className="big">{v}</div><div className="ctx">{c}</div></div>;
  return (
    <>
      <div className="g kpi">
        <K l="Visiting" v={`${active.length} / ${p.length}`} c={`${p.length - active.length} with no visit ${isToday ? 'yet' : 'that day'}`} />
        <K l="Visits" v={p.reduce((a, x) => a + x.visits, 0)} c={isToday ? `${p.filter(x => x.at_customer).length} in progress now` : 'customer visits'} />
        <K l="Outside geo-fence" v={p.reduce((a, x) => a + x.flagged, 0)} c="visits started away from the customer" />
      </div>
      <section className="card">
        <div className="toolbar"><div className="l"><label className="user" htmlFor="team-day">Date <input id="team-day" type="date" value={day} max={nptToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
          {isToday && <span className="live"><i />refreshes every 30 seconds</span>}</div><div className="r"><Link className="btn" href="/map">Open live map</Link><Link className="btn" href="/visits">Visit report</Link></div></div>
        {err && <div className="errbox" role="alert">{err}</div>}
        <div className="tbl"><table><thead><tr><th>Person</th><th>Area</th><th>Status</th><th>First visit</th><th>Last visit</th><th className="r">Visits</th><th>Last location</th><th></th></tr></thead>
          <tbody>{p.map(x => { const [t, k] = status(x); return <tr key={x.id}><td><b>{x.name}</b><br /><span className="code">{x.code} · {x.role}</span></td><td>{x.area || x.region || '–'}</td><td><span className={`pill ${k}`}>{t}</span></td>
            <td className="num">{fmtTime(x.first_visit_at)}</td><td className="num">{fmtTime(x.last_visit_at)}</td>
            <td className="r num">{x.visits}{x.flagged ? <span className="pill crit" style={{ marginLeft: 6 }}>{x.flagged} flagged</span> : null}</td>
            <td className="code">{isToday && x.last_ping ? fmtTime(x.last_ping) : '–'}</td>
            <td>{x.visits > 0 && <a className="btn sm" href={`/map?user=${x.id}&day=${day}`}>Day on map</a>}</td></tr>; })}
            {people && !p.length && <tr><td colSpan={8}><p className="sub" style={{ padding: '12px 0' }}>No field staff in your team yet. Add employees with a field role and an area.</p></td></tr>}
            {!people && !err && <tr><td colSpan={8}><p className="sub" style={{ padding: '12px 0' }}>Loading…</p></td></tr>}</tbody></table></div>
      </section>
    </>
  );
}
