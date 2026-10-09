'use client';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/ui';
import { fmtDist, fmtTime, nptToday } from '@/lib/geo';

export default function Visits() {
  const [from, setFrom] = useState(nptToday()); const [to, setTo] = useState(nptToday());
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [flag, setFlag] = useState(false);
  const load = useCallback(() => { if (from > to) { setErr('The from date is after the to date.'); return; } call(`/api/visits?from=${from}&to=${to}`).then(r => { setRows(r.visits); setErr(''); }).catch(e => setErr(e.message)); }, [from, to]);
  useEffect(() => { load(); }, [load]);
  const list = (rows || []).filter(r => !flag || r.out_of_fence);
  const mins = (r: any) => r.out_at ? Math.max(1, Math.round((Date.parse(r.out_at) - Date.parse(r.in_at)) / 60000)) + ' min' : 'open';
  return (
    <section className="card">
      <div className="toolbar"><div className="l">
        <label className="user" htmlFor="vis-from">From <input id="vis-from" type="date" value={from} max={nptToday()} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="user" htmlFor="vis-to">To <input id="vis-to" type="date" value={to} max={nptToday()} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <label className="chk"><input id="vis-flag" type="checkbox" checked={flag} onChange={e => setFlag(e.target.checked)} /> Only outside geo-fence</label></div>
        <div className="r"><span className="sub">{list.length} visits{rows && rows.length >= 2000 ? ' (first 2,000 shown; narrow the dates)' : ''}</span></div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="tbl"><table><thead><tr><th>Date</th><th>Person</th><th>Customer</th><th>In</th><th>Duration</th><th>Location</th><th>Purpose</th><th>Person met</th><th>Remarks</th><th>Next visit</th></tr></thead>
        <tbody>{list.map(r => <tr key={r.id}><td className="num">{r.day}</td><td><b>{r.person}</b><br /><span className="code">{r.person_code}</span></td><td>{r.customer}<br /><span className="code">{r.customer_code} · {r.town || '–'}</span></td>
          <td className="num">{fmtTime(r.in_at)}</td><td className="num">{mins(r)}</td><td>{r.out_of_fence ? <span className="pill crit">{fmtDist(r.distance_m)} away</span> : <span className="pill good">At location</span>}</td>
          <td>{r.purpose || '–'}</td><td>{r.person_met || '–'}</td><td style={{ maxWidth: 280 }}>{r.remarks || '–'}</td><td className="num">{r.next_visit || '–'}</td></tr>)}
          {rows && !list.length && <tr><td colSpan={10}><p className="sub" style={{ padding: '12px 0' }}>No visits in these dates.</p></td></tr>}</tbody></table></div>
    </section>
  );
}
