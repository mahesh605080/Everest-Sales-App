'use client';
import { useEffect, useState } from 'react';

export type Filter = { status: string; q: string; from: string; to: string };
export const noFilter: Filter = { status: '', q: '', from: '', to: '' };
export const filterQuery = (f: Filter) => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');

/** Status, text and date filters shared by the booklet, order and request lists. Typing waits a moment before searching. */
export default function FilterBar({ id, statuses, value, onChange, hint }: { id: string; statuses: string[]; value: Filter; onChange: (f: Filter) => void; hint: string }) {
  const [text, setText] = useState(value.q);
  useEffect(() => { const t = setTimeout(() => { if (text !== value.q) onChange({ ...value, q: text }); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = value.status || value.q || value.from || value.to;
  return <div className="toolbar"><div className="l">
    <input id={`${id}-q`} className="search" type="text" aria-label="Search" placeholder={hint} value={text} onChange={e => setText(e.target.value)} />
    {statuses.length > 0 && <label className="user" htmlFor={`${id}-st`}>Status <select id={`${id}-st`} value={value.status} onChange={e => onChange({ ...value, status: e.target.value })}><option value="">Any</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>}
    <label className="user" htmlFor={`${id}-from`}>From <input id={`${id}-from`} type="date" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })} /></label>
    <label className="user" htmlFor={`${id}-to`}>To <input id={`${id}-to`} type="date" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })} /></label>
    {active && <button className="btn sm" onClick={() => { setText(''); onChange(noFilter); }}>Clear</button>}</div></div>;
}
