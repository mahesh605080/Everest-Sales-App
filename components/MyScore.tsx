'use client';
import { useEffect, useState } from 'react';
import { call, rs } from '@/lib/ui';

/** A field user's own month: target, approved sales, score. */
export default function MyScore() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call('/api/perf').then(setD).catch(() => {}); }, []);
  const r = d?.rows?.[0]; if (!r) return null;
  const pace = Math.round(d.info.pace * 100);
  return <section className="card"><div className="hd"><h2>My month</h2><span className={`pill ${r.score >= 80 ? 'good' : r.score >= 60 ? 'info' : 'crit'}`}>Score {r.score}</span></div>
    {r.ach != null && <div className="meter"><i style={{ width: `${Math.min(100, r.ach)}%` }} /></div>}
    <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
      <div><div className="lab">Target</div><div className="num">{r.target ? rs(r.target) : 'not set'}</div></div>
      <div><div className="lab">Approved sales</div><div className="num">{rs(r.sales)}{r.ach != null ? ` · ${r.ach.toFixed(0)}%` : ''}</div></div>
      <div><div className="lab">Pace today</div><div className="num">{pace}%</div></div>
      <div><div className="lab">Collection</div><div className="num">{rs(r.collection)}</div></div>
      <div><div className="lab">Visits</div><div className="num">{r.visits}{r.planned ? ` · ${r.planned_done}/${r.planned} planned` : ''}</div></div>
      <div><div className="lab">Days with visits</div><div className="num">{r.days_present}</div></div></div>
    <p className="sub">Score parts: visits {r.parts.visits}, sales {r.parts.sales}, collection {r.parts.collection}, visit quality {r.parts.discipline} (each out of 100).</p></section>;
}
