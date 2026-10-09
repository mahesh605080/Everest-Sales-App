'use client';
import { rs } from '@/lib/ui';

export const ST: Record<string, string> = { Pending: 'warn', 'Sent back': 'warn', Accepted: 'good', Approved: 'good', Dispatched: 'info', Rejected: 'crit', Cancelled: 'crit', Expired: '', Withdrawn: '' };
export const Status = ({ s }: { s: string }) => <span className={`pill ${ST[s] || ''}`}>{s === 'Approved' ? 'Approved, dispatch pending' : s}</span>;
export const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });

export function CreditBox({ c }: { c: any }) {
  if (!c) return null;
  const t = c.outstanding || 1, K = ({ l, v, k }: any) => <div><div className="lab">{l}</div><div className="num" style={k ? { color: 'var(--crit)', fontWeight: 600 } : undefined}>{v}</div></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--canvas)', borderRadius: 10, padding: 12 }}>
      <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        <K l="Credit limit" v={rs(c.credit_limit)} /><K l={`Outstanding${c.as_of ? ' (as of ' + c.as_of + ')' : ''}`} v={rs(c.outstanding)} />
        <K l="Approved, not dispatched" v={rs(c.committed)} /><K l="Available credit" v={rs(c.available)} k={c.available < 0} /></div>
      {c.outstanding > 0 && <><div className="aging">{[c.b0, c.b1, c.b2, c.b3].map((v: number, i: number) => v > 0 ? <i key={i} className={`a${i}`} style={{ flex: v / t }} /> : null)}</div>
        <div className="legend"><span><i className="a0" />0–30: {rs(c.b0)}</span><span><i className="a1" />31–60: {rs(c.b1)}</span><span><i className="a2" />61–90: {rs(c.b2)}</span><span><i className="a3" />90+: {rs(c.b3)}</span></div></>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {c.stale && <span className="pill warn">{c.as_of ? `Outstanding data is ${c.age_days} days old` : 'No outstanding data uploaded yet'}</span>}
        {c.dda_expired && <span className="pill crit">DDA licence expired on {c.dda_expiry}</span>}
        {(c.instruments || []).filter((i: any) => i.status === 'Active').map((i: any) => <span key={i.id} className={`pill ${i.expired ? 'crit' : i.expiring ? 'warn' : 'info'}`}>{i.type} {i.ref_no || ''} · {rs(i.amount)} · {i.expired ? 'expired' : 'to'} {i.expiry_date}</span>)}
        {!(c.instruments || []).some((i: any) => i.status === 'Active') && <span className="pill">No active instrument</span>}</div>
    </div>
  );
}
export const Trail = ({ rows }: { rows: any[] }) => (
  <ol className="tl">{rows.map((t, i) => <li key={i}><time>{when(t.at).slice(7)}</time><div><b>{t.user_name}</b> · {t.action}{t.level ? ` (${t.level.toUpperCase()})` : ''}<br /><span className="sub">{when(t.at).slice(0, 6)}{t.remarks ? ` · “${t.remarks}”` : ''}</span></div></li>)}</ol>
);
export const VarPill = ({ v }: { v: number }) => v <= 0.005 ? <span className="pill good">At or above base rate</span> : <span className={`pill ${v > 5 ? 'crit' : 'warn'}`}>{v.toFixed(1)}% below base</span>;
