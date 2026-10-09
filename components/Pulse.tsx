'use client';
import { useEffect, useState } from 'react';
import { call, rs } from '@/lib/ui';

const COLOR: Record<string, string> = { crit: 'var(--crit)', warn: 'var(--warn)', good: 'var(--good)' };
const sh = (n: number) => n >= 1e7 ? 'Rs ' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? 'Rs ' + (n / 1e5).toFixed(1) + ' L' : rs(n);

/** Sales and loss at a glance; every card opens the screen where it is fixed. */
export default function Pulse() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call('/api/pulse').then(setD).catch(() => {}); }, []);
  if (!d || !d.cards.length) return null;
  return <><h2 style={{ marginTop: 4 }}>Sales and loss today</h2>
    <div className="g kpi">{d.cards.map((c: any) => <a key={c.k} href={c.href} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="lab">{c.label}</div><div className="big" style={{ color: COLOR[c.tone] }}>{c.money ? sh(c.value) : c.value}</div><div className="ctx">{c.sub}</div></a>)}</div></>;
}
