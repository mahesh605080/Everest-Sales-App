'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { call } from '@/lib/ui';

const sh = (n: number) => n >= 1e7 ? 'Rs ' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? 'Rs ' + (n / 1e5).toFixed(1) + ' L' : 'Rs ' + Math.round(n).toLocaleString('en-IN');

/** Credit Control's start page: what is waiting, and how healthy the credit data is. */
export default function CreditHome() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { const load = () => call('/api/credit?summary=1').then(setD).catch(() => {}); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (!d) return null;
  const K = ({ l, v, c, bad }: any) => <div className="card"><div className="lab">{l}</div><div className="big" style={bad ? { color: 'var(--crit)' } : undefined}>{v}</div><div className="ctx">{c}</div></div>;
  return <>
    {d.stale && <div className="banner">{d.upload_age == null ? 'No outstanding figures have been uploaded yet, so every customer shows zero outstanding.' : `The outstanding figures are ${d.upload_age} days old.`} <Link href="/credit">Upload the latest export</Link>.</div>}
    <div className="g kpi">
      <K l="Orders to approve" v={d.queue} c={<Link href="/credit">open the queue</Link>} />
      <K l="Waiting for dispatch" v={d.to_dispatch} c="approved, not yet dispatched" />
      <K l="Collections to verify" v={d.collections} c={<Link href="/r/collections">open collections</Link>} />
      <K l="To pay or settle" v={d.expenses + d.claims} c={`${d.expenses} expenses · ${d.claims} claims`} />
      <K l="Instruments" v={d.inst_expired + d.inst_expiring} bad={d.inst_expired > 0} c={`${d.inst_expired} expired · ${d.inst_expiring} within 30 days`} />
      <K l="Outstanding" v={sh(d.outstanding)} c={<>{sh(d.over90)} over 90 days · {d.near_limit} customers above 80% of limit</>} />
    </div>
    <h2 style={{ marginTop: 8 }}>Master data health</h2>
  </>;
}
