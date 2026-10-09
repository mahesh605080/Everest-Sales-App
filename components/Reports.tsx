'use client';
import { useState } from 'react';
import { nptToday } from '@/lib/geo';

export default function Reports({ reports }: { reports: { key: string; label: string; group: string; range: string }[] }) {
  const t = nptToday(); const [from, setFrom] = useState(t.slice(0, 8) + '01'); const [to, setTo] = useState(t); const [month, setMonth] = useState(t.slice(0, 7));
  const groups = [...new Set(reports.map(r => r.group))];
  const href = (r: any) => `/api/reports/${r.key}?` + (r.range === 'dates' ? `from=${from}&to=${to}` : r.range === 'month' ? `month=${month}` : '');
  return <>
    <section className="card"><div className="toolbar"><div className="l">
      <label className="user" htmlFor="rp-from">From <input id="rp-from" type="date" value={from} max={t} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
      <label className="user" htmlFor="rp-to">To <input id="rp-to" type="date" value={to} max={t} onChange={e => e.target.value && setTo(e.target.value)} /></label>
      <label className="user" htmlFor="rp-month">Month <input id="rp-month" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label></div></div>
      <p className="sub">Each report downloads as Excel and contains only your territory. Date-range reports use From and To; monthly reports use Month; the rest show the position as of now.</p></section>
    {groups.map(g => <section className="card" key={g}><h2>{g}</h2><div className="repgrid">{reports.filter(r => r.group === g).map(r =>
      <a key={r.key} className="rep" href={href(r)} style={{ textDecoration: 'none', color: 'inherit' }}><b>{r.label}</b><span>{r.range === 'dates' ? `${from} to ${to}` : r.range === 'month' ? month : 'as of now'} · Excel</span></a>)}</div></section>)}
  </>;
}
