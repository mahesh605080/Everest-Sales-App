'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, rs, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';

export default function Scorecard({ canTargets }: { canTargets: boolean }) {
  const [month, setMonth] = useState(nptToday().slice(0, 7)); const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  const [sort, setSort] = useState<[string, number]>(['score', -1]); const [edit, setEdit] = useState<Record<number, string>>({}); const [busy, setBusy] = useState(false);
  const load = useCallback(() => call(`/api/perf?month=${month}`).then(r => { setD(r); setEdit({}); setErr(''); }).catch(e => setErr(e.message)), [month]);
  useEffect(() => { setD(null); load(); }, [load]);
  const rows = [...(d?.rows || [])].sort((a, b) => { const [k, dir] = sort, x = a[k] ?? -1, y = b[k] ?? -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
  const th = (k: string, label: string, r = false) => <th className={r ? 'r' : ''} data-sort={k} tabIndex={0} onClick={() => setSort(s => [k, s[0] === k ? -s[1] : -1])} onKeyDown={e => e.key === 'Enter' && setSort(s => [k, s[0] === k ? -s[1] : -1])}>{label}{sort[0] === k ? (sort[1] < 0 ? ' ↓' : ' ↑') : ''}</th>;
  async function save() { setBusy(true); try { const r = await call('/api/targets', { method: 'PUT', json: { month, items: Object.entries(edit).filter(([, v]) => v !== '').map(([id, v]) => ({ user_id: Number(id), amount: Number(v) })) } }); toast(`${r.saved} target${r.saved === 1 ? '' : 's'} saved.`); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const pace = d ? Math.round(d.info.pace * 100) : 0;
  return <>
    <section className="card">
      <div className="toolbar"><div className="l"><label className="user" htmlFor="sc-month">Month <input id="sc-month" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        {d && <span className="sub">day {d.info.elapsed} of {d.info.days} · pace {pace}% · click a column to sort</span>}</div>
        <div className="r">{canTargets && <><a className="btn" href={`/api/targets?month=${month}`}>Download targets sheet</a>
          <label className="btn" style={{ cursor: 'pointer' }}>Upload targets<input id="sc-file" type="file" accept=".xlsx,.csv" hidden onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const fd = new FormData(); fd.append('file', f); fd.append('month', month);
            try { const r = await call('/api/targets', { method: 'POST', body: fd }); toast(`${r.saved} targets saved, ${r.unchanged} unchanged, ${r.failed} rows skipped.`); await load(); if (r.failed) setErr('Skipped: ' + r.errors.slice(0, 5).map((x: any) => `row ${x.row}: ${x.message}`).join(' ')); } catch (x: any) { setErr(x.message); } }} /></label></>}
          {canTargets && Object.keys(edit).length > 0 && <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save targets'}</button>}</div></div>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="tbl"><table><thead><tr>{th('name', 'Person')}{th('area', 'Area')}{th('target', 'Target (Rs)', true)}{th('sales', 'Approved sales', true)}{th('ach', 'Achievement')}{th('collection', 'Collection', true)}{th('visits', 'Visits', true)}{th('days_present', 'Days', true)}{th('score', 'Score', true)}{th('incentive', pace >= 100 ? 'Incentive' : 'Projected incentive', true)}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td><b>{r.name}</b><br /><span className="code">{r.code} · {r.role}</span></td><td>{r.area || r.region || '–'}</td>
          <td className="r">{canTargets ? <input type="number" min={0} step={50000} aria-label={`Target for ${r.name}`} value={edit[r.id] ?? String(r.target || '')} onChange={e => setEdit(o => ({ ...o, [r.id]: e.target.value }))} style={{ width: 130, textAlign: 'right' }} /> : <span className="num">{r.target ? rs(r.target) : '–'}</span>}</td>
          <td className="r num">{rs(r.sales)}</td>
          <td>{r.ach == null ? <span className="pill">No target</span> : <><div className="meter"><i style={{ width: `${Math.min(100, r.ach)}%` }} /></div><span className="num">{r.ach.toFixed(0)}% <span className={r.ach >= pace ? 'up' : 'dn'}>{r.ach >= pace ? 'ahead' : 'behind'}</span></span></>}</td>
          <td className="r num">{rs(r.collection)}</td><td className="r num">{r.visits}{r.planned ? ` · ${r.planned_done}/${r.planned} planned` : ''}{r.flagged ? <span className="pill crit">{r.flagged} flagged</span> : null}</td>
          <td className="r num">{r.days_present}{r.days_late ? ` · ${r.days_late} late` : ''}</td>
          <td className="r"><span className={`pill ${r.score >= 80 ? 'good' : r.score >= 60 ? 'info' : 'crit'}`} title={`Visits ${r.parts.visits} · Sales ${r.parts.sales} · Collection ${r.parts.collection} · Discipline ${r.parts.discipline}`}>{r.score}</span></td>
          <td className="r num">{r.incentive ? rs(r.incentive) : '–'}</td></tr>)}
          {d && !rows.length && <tr><td colSpan={10}><p className="sub" style={{ padding: '12px 0' }}>No field staff in your team yet.</p></td></tr>}</tbody></table></div>
    </section>
    {d && <section className="card"><h2>How the numbers are built</h2><div className="g half">
      <div><b>Visits {d.weights.visits}%</b><p className="sub">Planned visits done, when there is an approved tour plan; otherwise visits per day present against the norm in Settings.</p></div>
      <div><b>Sales {d.weights.sales}%</b><p className="sub">Approved order value against the target at today's pace.</p></div>
      <div><b>Collection {d.weights.collection}%</b><p className="sub">Collections this month against the overdue (31+ days) balance of assigned customers in the last outstanding upload.</p></div>
      <div><b>Discipline {d.weights.discipline}%</b><p className="sub">On-time check-ins and visits started inside the geo-fence.</p></div>
      <div><b>Incentive</b><p className="sub">{d.incentive.at90}% of target at 90% achievement, {d.incentive.at100}% at 100%. During the month it is projected from the current pace. Change the rates in Settings.</p></div></div></section>}
  </>;
}
