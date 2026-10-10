import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useData } from '@/lib/data';
import { rs } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, Empty, ErrorBox, Loading, Num, Pill, Row, Screen, Spread, Stale, Sub } from '@/ui/kit';
import { T } from '@/theme';

export default function Offers() {
  const d = useData<{ expiry: any[] }>('/api/sales/opportunities'); const router = useRouter(); const { can } = useSession();
  const list = d.data?.expiry ?? [];
  return <Screen onRefresh={d.refresh} refreshing={d.loading && !!d.data}>
    <Sub>Stock close to expiry with a pre-approved price, matched to the customers who can use it in time. Sold as non-returnable.</Sub>
    <Stale show={d.stale} at={d.at} /><ErrorBox text={d.error} />{!d.data && d.loading && <Loading />}
    {d.data && !list.length && <Card><Empty icon="pricetags-outline" title="No near-expiry lot for your customers now" /></Card>}
    {list.map((e, i) => <Card key={i} tone="warn">
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 2 }}><Text style={T.h2}>{e.customer}</Text><Sub>{e.product} · batch {e.batch_no}</Sub></View><Num>{rs(e.value)}</Num></Spread>
      <Row wrap gap={6}><Pill tone={e.months_left <= 3 ? 'crit' : 'warn'}>expires {e.expiry_date}</Pill><Pill tone="good">{e.offer}</Pill></Row>
      <Sub>Can use {e.can_take} boxes in time · Rs {Number(e.rate).toFixed(2)} against {Number(e.trade_rate).toFixed(2)}</Sub>
      {can('orders.create') && <Button small title="Create order" icon="add" onPress={() => router.push(`/order/new?customer=${e.customer_id}&batch=${e.batch_id}&qty=${e.can_take}` as any)} />}
    </Card>)}
  </Screen>;
}
