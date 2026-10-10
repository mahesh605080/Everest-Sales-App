import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { rs, when } from '@/lib/format';
import { CreditCard } from '@/ui/credit';
import { Button, Card, ErrorBox, Field, H2, Line, Loading, Num, Pill, Row, Screen, Spread, Stale, Sub, done, statusTone } from '@/ui/kit';
import { T } from '@/theme';

export default function Order() {
  const { id } = useLocalSearchParams<{ id: string }>(); const d = useData<any>(`/api/orders/${id}`);
  const [rm, setRm] = useState(''); const [inv, setInv] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  async function act(action: string) { setBusy(action); setErr(''); try { await call(`/api/orders/${id}`, { json: { action, remarks: rm, invoice_no: inv } }); done(); setRm(''); await d.refresh(); } catch (e: any) { setErr(e?.message ?? 'Could not save.'); } finally { setBusy(''); } }
  if (!d.data) return <Screen>{d.loading ? <Loading /> : <ErrorBox text={d.error || 'Could not open this order.'} />}</Screen>;
  const o = d.data.order;
  return <Screen onRefresh={d.refresh} refreshing={d.loading}>
    <View style={{ gap: 4 }}><Spread><Text style={T.h1}>{o.no}</Text><Pill tone={statusTone(o.status)}>{o.status}</Pill></Spread><Sub>{o.customer} · {o.order_date} · {o.person}{o.booklet_no ? ` · booklet ${o.booklet_no}` : ''}</Sub>
      <Row wrap gap={6}>{o.over_now && <Pill tone="crit">Over credit limit</Pill>}{o.invoice_no && <Pill tone="info">Invoice {o.invoice_no}</Pill>}</Row></View>
    <Stale show={d.stale} at={d.at} />
    <Card>{d.data.items.map((i: any, n: number) => <View key={i.id} style={{ gap: 3 }}>{n > 0 && <Line />}
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1 }}><Text style={[T.body, { fontWeight: '700' }]}>{i.product}</Text><Sub>{i.qty} boxes{i.free_qty ? ` + ${i.free_qty} free` : ''} · Rs {Number(i.rate).toFixed(2)}{i.pack_size ? ` · ${i.pack_size}` : ''}</Sub></View><Num>{rs(i.value)}</Num></Spread>
      <Row wrap gap={6}>{i.non_returnable && <Pill tone="warn">Near-expiry lot · non-returnable</Pill>}{i.scheme_text && <Pill tone="good">{i.scheme_text}</Pill>}</Row>
      {i.sent?.length > 0 && <Sub>Sent: {i.sent.map((x: any) => `${x.batch_no} × ${x.qty}`).join(', ')}</Sub>}
      {i.fefo && <Sub>Send first: {i.fefo.plan.map((x: any) => `${x.batch_no} (exp ${x.expiry_date}) × ${x.qty}`).join(', ')}{i.fefo.short ? ` · ${i.fefo.short} boxes not in stock` : ''}</Sub>}</View>)}
      <Line /><Spread><H2>Total</H2><Num style={{ fontSize: 18 }}>{rs(o.value)}</Num></Spread></Card>
    {o.remarks ? <Card><Sub>Remarks</Sub><Text style={T.body}>{o.remarks}</Text></Card> : null}
    <ErrorBox text={err} />
    {d.data.canDecide && <Card style={{ gap: 12 }}><H2>Decide</H2><Field label="Remarks" value={rm} onChangeText={setRm} placeholder={o.over_now ? 'Over limit: name the instrument or approval' : 'Needed to reject'} />
      <Row><Button style={{ flex: 1 }} title="Approve" busy={busy === 'approve'} onPress={() => act('approve')} /><Button style={{ flex: 1 }} kind="danger" title="Reject" busy={busy === 'reject'} onPress={() => act('reject')} /></Row></Card>}
    {d.data.canDispatch && <Card style={{ gap: 12 }}><H2>Dispatch</H2><Field label="Invoice number" value={inv} onChangeText={setInv} placeholder="Optional" /><Button title="Mark dispatched" icon="cube-outline" busy={busy === 'dispatch'} onPress={() => act('dispatch')} /></Card>}
    {d.data.canWithdraw && <Button kind="danger" title="Withdraw this order" busy={busy === 'withdraw'} onPress={() => act('withdraw')} />}
    <CreditCard c={d.data.credit} />
    <Card><H2>What happened</H2>{d.data.trail.map((t: any, i: number) => <View key={i}><Text style={[T.body, { fontWeight: '600' }]}>{t.action} · {t.user_name}</Text><Sub>{when(t.at)}{t.remarks ? ` · ${t.remarks}` : ''}</Sub></View>)}</Card>
  </Screen>;
}
