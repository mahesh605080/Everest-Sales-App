'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { call, rs } from '@/lib/ui';
import { fmtTime, nptToday } from '@/lib/geo';

function status(p: any, isToday: boolean): [string, string] {
  if (!p.in_at && p.on_leave) return ['On leave', ''];
  if (!p.in_at) return [isToday ? 'Not checked in' : 'Absent', 'crit'];
  if (p.auto_closed) return ['Missed check-out', 'warn'];
  if (p.out_at) return ['Day closed', ''];
  if (p.at_customer) return [`On visit: ${p.at_customer}`, 'good'];
  const last = Date.parse(p.last_visit_at || p.in_at);
  return Date.now() - last > 2 * 3600000 ? ['No visit for 2h+', 'warn'] : ['In the field', 'info'];
}

export default function Team() {
  const [day, setDay] = useState(nptToday()); const [people, setPeople] = useState<any[] | null>(null); const [err, setErr] = useState('');
  const isToday = day === nptToday();
  const load = useCallback(() => call(`/api/team/today?day=${day}`).then(r => { setPeople(r.people); setErr(''); }).catch(e => setErr(e.message)), [day]);
  useEffect(() => { load(); if (!isToday) return; const t = setInterval(load, 30000); return () => clearInterval(t); }, [load, isToday]);
  const p = people || [], present = p.filter(x => x.in_at);
  const K = ({ l, v, c }: any) => <div className="card"><div className="lab">{l}</div><div className="big">{v}</div><div className="ctx">{c}</div></div>;
  return (
    <>
      <div className="g kpi">
        <K l="On duty" v={`${present.length} / ${p.length}`} c={`${p.filter(x => !x.in_at && !x.on_leave).length} not checked in · ${p.filter(x => !x.in_at && x.on_leave).length} on leave`} />
        <K l="Late" v={present.filter(x => x.late).length} c="after the check-in time in Settings" />
        <K l="Visits" v={p.reduce((a, x) => a + x.visits, 0)} c={`${p.filter(x => x.at_customer).length} in progress now`} />
        <K l="Outside geo-fence" v={p.reduce((a, x) => a + x.flagged, 0)} c="visits started away from the customer" />
        <K l="Projection" v={rs(present.reduce((a, x) => a + (x.projection || 0), 0))} c={`actual so far ${rs(present.reduce((a, x) => a + (x.actual || 0), 0))}`} />
      </div>
      <section className="card">
        <div className="toolbar"><div className="l"><label className="user" htmlFor="team-day">Date <input id="team-day" type="date" value={day} max={nptToday()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
          {isToday && <span className="live"><i />refreshes every 30 seconds</span>}</div><div className="r"><Link className="btn" href="/map">Open live map</Link></div></div>
        {err && <div className="errbox" role="alert">{err}</div>}
        <div className="tbl"><table><thead><tr><th>Person</th><th>Area</th><th>Status</th><th>Check-in</th><th>Check-out</th><th className="r">Visits</th><th className="r">Projection</th><th className="r">Actual</th><th>Last location</th></tr></thead>
          <tbody>{p.map(x => { const [t, k] = status(x, isToday); return <tr key={x.id}><td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{x.in_photo_id ? <a href={`/api/photo/${x.in_photo_id}`} target="_blank" rel="noreferrer"><img src={`/api/photo/${x.in_photo_id}`} alt={`Check-in selfie of ${x.name}`} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', display: 'block' }} /></a> : <div className="av">{x.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</div>}
              <div><b>{x.name}</b><br /><span className="code">{x.code} · {x.role}</span></div></div></td><td>{x.area || x.region || '–'}</td><td><span className={`pill ${k}`}>{t}</span></td>
            <td className="num">{fmtTime(x.in_at)} {x.late && <span className="pill warn">Late</span>}</td><td className="num">{fmtTime(x.out_at)}</td>
            <td className="r num">{x.visits}{x.flagged ? <span className="pill crit" style={{ marginLeft: 6 }}>{x.flagged} flagged</span> : null}</td>
            <td className="r num">{x.in_at ? rs(x.projection) : '–'}</td><td className="r num">{x.actual != null ? rs(x.actual) : '–'}</td>
            <td className="code">{isToday && x.last_ping ? fmtTime(x.last_ping) : '–'}</td></tr>; })}
            {people && !p.length && <tr><td colSpan={9}><p className="sub" style={{ padding: '12px 0' }}>No field staff in your team yet. Add employees with a field role and an area.</p></td></tr>}
            {!people && !err && <tr><td colSpan={9}><p className="sub" style={{ padding: '12px 0' }}>Loading…</p></td></tr>}</tbody></table></div>
      </section>
    </>
  );
}
