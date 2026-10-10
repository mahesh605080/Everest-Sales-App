import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useData } from '@/lib/data';
import { rs } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Card, Choice, Empty, ErrorBox, Loading, Num, Pill, Screen, Spread, Stale, Sub, statusTone, tap } from '@/ui/kit';
import { C, shadow, T } from '@/theme';

export default function Orders() {
  const router = useRouter(); const { can } = useSession();
  const boxes = [can('orders.create') && 'Mine', can('credit.manage') && 'To approve', (can('credit.manage') || can('dispatch.manage')) && 'To dispatch', can('sales.view') && 'Team'].filter(Boolean) as string[];
  const [box, setBox] = useState(boxes[0] ?? 'Mine'); const key = ({ Mine: 'mine', 'To approve': 'queue', 'To dispatch': 'approved', Team: 'all' } as Record<string, string>)[box];
  const d = useData<{ orders: any[] }>(`/api/orders?box=${key}`);
  useFocusEffect(useCallback(() => { d.refresh(); }, [d.refresh]));
  return <View style={{ flex: 1 }}><Screen onRefresh={d.refresh} refreshing={d.loading && !!d.data}>
    {boxes.length > 1 && <Choice options={boxes} value={box} onChange={setBox} />}
    <Stale show={d.stale} at={d.at} /><ErrorBox text={d.error} />
    {!d.data && d.loading && <Loading />}
    {d.data && !d.data.orders.length && <Card><Empty icon="receipt-outline" title="No orders here" text={box === 'Mine' ? 'Tap + to write the first one.' : undefined} /></Card>}
    {d.data?.orders.map(o => <Card key={o.id} onPress={() => router.push(`/order/${o.id}` as any)}>
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 2 }}><Text style={T.h2}>{o.customer}</Text><Sub>{o.no} · {o.order_date}{box !== 'Mine' ? ` · ${o.person}` : ''}</Sub></View><Num>{rs(o.value)}</Num></Spread>
      <Spread><Pill tone={statusTone(o.status)}>{o.status}</Pill>{o.status === 'Pending' && (o.over_now ?? o.over_limit) ? <Pill tone="crit">Over limit</Pill> : <View />}</Spread></Card>)}
  </Screen>
    {can('orders.create') && <Pressable accessibilityRole="button" accessibilityLabel="New order" onPress={() => { tap(); router.push('/order/new'); }} style={({ pressed }) => [{ position: 'absolute', right: 18, bottom: 18, width: 58, height: 58, borderRadius: 29, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', ...shadow, elevation: 6 }, pressed && { opacity: 0.85 }]}><Ionicons name="add" size={30} color="#fff" /></Pressable>}
  </View>;
}
