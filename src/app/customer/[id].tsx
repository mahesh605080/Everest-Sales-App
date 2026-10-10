import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { rs } from '@/lib/format';
import { getFix } from '@/lib/location';
import { useSession } from '@/lib/session';
import { CreditCard } from '@/ui/credit';
import { Button, Card, ErrorBox, H2, KV, Line, Loading, Note, Num, Pill, Row, Screen, Spread, Stale, Sub, done, statusTone } from '@/ui/kit';
import { S, T } from '@/theme';

export default function Customer() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { can } = useSession();
  const d = useData<any>(`/api/customer/${id}`); const day = useData<{ open: any }>(can('field.use') ? '/api/field/today' : null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  useFocusEffect(useCallback(() => { d.refresh(); day.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  async function checkIn() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const f = await getFix();
      const r = await call<{ visit: any }>('/api/field/visit/start', { json: { customer_id: Number(id), lat: f.lat, lng: f.lng, accuracy: f.accuracy, mocked: f.mocked, source: 'app' } });
      done(); await day.refresh();
      setMsg(r.visit.captured ? 'Checked in. This spot is now saved as the customer\'s location.' : r.visit.out_of_fence ? `Checked in ${r.visit.distance_m} m from the saved location (limit ${r.visit.radius} m). Your manager is told.` : 'Checked in.');
    } catch (e: any) { setErr(e?.message ?? 'Could not check in.'); } finally { setBusy(false); }
  }
  if (!d.data) return <Screen>{d.loading ? <Loading /> : <ErrorBox text={d.error || 'Could not open this customer.'} />}</Screen>;
  const c = d.data.customer, sel = d.data.selling, open = day.data?.open, here = open?.customer_id === c.id;
  return <Screen onRefresh={d.refresh} refreshing={d.loading}>
    <View style={{ gap: 4 }}><Text style={T.h1}>{c.name}</Text><Sub>{c.code} · {c.type}{c.town ? ` · ${c.town}` : ''}{c.contact_person ? ` · ${c.contact_person}` : ''}{c.phone ? ` · ${c.phone}` : ''}</Sub>
      <Row wrap gap={6} style={{ marginTop: 4 }}><Pill tone={sel.cls === 'A' ? 'good' : sel.cls === 'B' ? 'info' : 'plain'}>Class {sel.cls} · visit every {sel.norm_days} days</Pill>{!c.active && <Pill>Inactive</Pill>}</Row></View>
    <Stale show={d.stale} at={d.at} /><ErrorBox text={err} />{msg ? <Note tone="good" text={msg} /> : null}

    {can('field.use') && c.active && (here ? <Button title="Check out of this visit" icon="exit-outline" onPress={() => router.push('/visit')} />
      : open ? <Note tone="warn" text={`A visit at ${open.customer} is still open. Check out there first.`} />
        : <Button title="Check in here" icon="location-outline" busy={busy} onPress={checkIn} />)}
    {c.active && <Row wrap>{can('orders.create') && <><Button small style={{ flexGrow: 1 }} title="New order" icon="add" onPress={() => router.push(`/order/new?customer=${c.id}` as any)} /><Button small kind="soft" style={{ flexGrow: 1 }} title="Repeat last" icon="repeat" onPress={() => router.push(`/order/new?customer=${c.id}&repeat=1` as any)} /></>}
      {can('collections.create') && <Button small kind="soft" style={{ flexGrow: 1 }} title="Collection" icon="cash-outline" onPress={() => router.push(`/collection?customer=${c.id}` as any)} />}
      {can('stock.report') && c.type === 'Distributor' && <Button small kind="soft" style={{ flexGrow: 1 }} title="Stock" icon="cube-outline" onPress={() => router.push(`/stock?customer=${c.id}` as any)} />}</Row>}

    <CreditCard c={d.data.credit} />
    <Card><H2>Selling to this customer</H2>
      <Row wrap gap={S.md}><KV k="Sales, 12 months" v={rs(d.data.totals.sales_12m)} /><KV k="Returns allowance left" v={rs(sel.allowance.left)} />
        {sel.rebate && <KV k="Yearly rebate" v={<View><Num>{sel.rebate.pct ? `${sel.rebate.pct}% earned` : 'none yet'}</Num>{sel.rebate.gap != null && <Sub>{rs(sel.rebate.gap)} more for {sel.rebate.next_pct}%</Sub>}</View>} />}</Row>
      {sel.schemes.length > 0 && <><Line /><Sub>Schemes running</Sub>{sel.schemes.map((x: any) => <Row key={x.code} wrap gap={6}><Text style={T.body}>{x.product}</Text><Pill tone="good">{x.text}</Pill><Sub>from {x.min_qty} boxes</Sub></Row>)}</>}
      {sel.rates.length > 0 && <><Line /><Sub>Own rates</Sub>{sel.rates.map((r: any, i: number) => <Spread key={i}><Text style={[T.body, { flex: 1 }]}>{r.product}</Text><Num>{Number(r.rate).toFixed(2)}</Num><Sub>{r.source === 'customer' ? 'contract' : 'price list'}</Sub></Spread>)}</>}
    </Card>
    {d.data.stock.length > 0 && <Card><Spread><H2>Stock at the customer</H2><Sub>{d.data.stock[0].day}</Sub></Spread>
      {d.data.stock.map((x: any, i: number) => { const days = x.sold_30d > 0 ? Math.round(x.stock / x.sold_30d * 30) : null; return <Spread key={i}><Text style={[T.body, { flex: 1 }]}>{x.product}</Text><Sub>{x.stock} held · {x.sold_30d} sold</Sub>{days != null && <Pill tone={days < 15 ? 'crit' : days > 90 ? 'warn' : 'good'}>{days} d</Pill>}</Spread>; })}</Card>}
    <Card><H2>Recent orders</H2>{d.data.orders.length ? d.data.orders.slice(0, 6).map((o: any) => <Spread key={o.id}><View style={{ flex: 1 }}><Text style={[T.body, { fontWeight: '600' }]} onPress={() => router.push(`/order/${o.id}` as any)}>{o.no}</Text><Sub>{o.order_date}</Sub></View><Num>{rs(o.value)}</Num><Pill tone={statusTone(o.status)}>{o.status}</Pill></Spread>) : <Sub>No orders yet.</Sub>}</Card>
    <Card><H2>Recent visits</H2>{d.data.visits.length ? d.data.visits.slice(0, 5).map((v: any, i: number) => <View key={i} style={{ gap: 2 }}><Spread><Text style={[T.body, { fontWeight: '600' }]}>{v.day} · {v.purpose || 'open'}</Text>{v.out_of_fence && <Pill tone="crit">off location</Pill>}</Spread><Sub lines={2}>{v.person} · {v.remarks || 'no remarks'}</Sub></View>) : <Sub>Never visited.</Sub>}</Card>
  </Screen>;
}
