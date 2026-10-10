import { rs } from '@/lib/format';
import { S } from '@/theme';
import { Card, H2, KV, Num, Pill, Row, Sub } from './kit';

export function CreditCard({ c }: { c: any }) {
  const over = c.available < 0;
  return <Card tone={c.dda_expired || over ? 'crit' : undefined}><H2>Credit</H2>
    <Row wrap gap={S.md}><KV k="Available" v={<Num style={{ fontSize: 18, color: over ? '#B42318' : undefined }}>{rs(c.available)}</Num>} /><KV k="Limit" v={rs(c.credit_limit)} /><KV k="Outstanding" v={rs(c.outstanding)} /><KV k="Approved, not sent" v={rs(c.committed)} /></Row>
    <Sub>{c.as_of ? `Outstanding as of ${c.as_of}${c.stale ? ' (old figure)' : ''}` : 'No outstanding figure uploaded yet'}{Number(c.b2) + Number(c.b3) > 0 ? ` · ${rs(Number(c.b2) + Number(c.b3))} is over 60 days` : ''}</Sub>
    {c.dda_expired && <Pill tone="crit">DDA licence expired</Pill>}</Card>;
}

