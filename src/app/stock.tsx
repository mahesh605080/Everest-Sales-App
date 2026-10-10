import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useData } from '@/lib/data';
import { newRef } from '@/lib/format';
import { submit } from '@/lib/outbox';
import { Product } from '@/lib/pricing';
import { Button, Card, ErrorBox, Loading, Note, Screen, Stale, Sub, done } from '@/ui/kit';
import { CustomerPicker, useCustomerName } from '@/ui/picker';
import { C, R, T } from '@/theme';

type RowV = { stock: string; sold_30d: string; near_expiry: string };
const COLS: [keyof RowV, string][] = [['stock', 'In stock'], ['sold_30d', 'Sold in 30 days'], ['near_expiry', 'Near expiry']];

export default function Stock() {
  const p = useLocalSearchParams<{ customer?: string }>(); const router = useRouter();
  const [cust, setCust] = useState(p.customer ?? ''); const name = useCustomerName(cust);
  const prods = useData<{ rows: Product[] }>('/api/m/products?size=500'), last = useData<{ last_day: string | null; items: any[] }>(cust ? `/api/stock?customer=${cust}` : null);
  const [v, setV] = useState<Record<number, RowV>>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ref] = useState(newRef);
  useEffect(() => { if (last.data) setV(Object.fromEntries(last.data.items.map(i => [i.product_id, { stock: String(i.stock), sold_30d: String(i.sold_30d), near_expiry: String(i.near_expiry) }]))); }, [last.data]);
  async function save() {
    const items = Object.entries(v).map(([pid, x]) => ({ product_id: Number(pid), stock: Number(x.stock) || 0, sold_30d: Number(x.sold_30d) || 0, near_expiry: Number(x.near_expiry) || 0 })).filter(i => i.stock > 0 || i.sold_30d > 0 || i.near_expiry > 0);
    if (!items.length) { setErr('Enter stock or sales for at least one product.'); return; }
    if (items.some(i => i.near_expiry > i.stock)) { setErr('Near-expiry boxes cannot be more than the stock.'); return; }
    setBusy(true); setErr('');
    try { const r = await submit({ ref, kind: 'stock', path: '/api/stock', title: `Stock report · ${name ?? 'distributor'}`, sub: `${items.length} ${items.length === 1 ? 'product' : 'products'}`, body: { customer_id: Number(cust), items } }); done(); if (r.queued) router.replace('/outbox'); else router.back(); }
    catch (e: any) { setErr(e?.message ?? 'Could not save the report.'); } finally { setBusy(false); }
  }
  if (!cust) return <Screen><CustomerPicker title="Which distributor?" only={c => c.type === 'Distributor'} onPick={c => setCust(String(c.id))} /></Screen>;
  return <Screen footer={<Button title="Save stock report" icon="checkmark" busy={busy} onPress={save} />}>
    <Text style={T.h1}>{name ?? 'Distributor'}</Text>
    <Sub>{last.data?.last_day ? `Last report ${last.data.last_day}; its figures are filled in. Change what is different.` : 'Count the boxes on the shelf and ask what sold in the last 30 days.'}</Sub>
    <Stale show={prods.stale} at={prods.at} /><ErrorBox text={err || prods.error} />
    <Note tone="info" text="This report drives the suggested order and warns before stock expires at the distributor." />
    {!prods.data && prods.loading && <Loading />}
    {prods.data?.rows.map(x => <Card key={x.id} style={{ gap: 8 }}><Text style={[T.body, { fontWeight: '700' }]}>{x.name} <Text style={T.sub}>{x.pack_size || ''}</Text></Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{COLS.map(([k, label]) => <View key={k} style={{ flex: 1, gap: 4 }}><Text style={T.label}>{label}</Text>
        <TextInput accessibilityLabel={`${x.name}: ${label}`} keyboardType="number-pad" value={v[x.id]?.[k] ?? ''} placeholder="0" placeholderTextColor={C.faint}
          onChangeText={t => setV(o => ({ ...o, [x.id]: { ...(o[x.id] ?? { stock: '', sold_30d: '', near_expiry: '' }), [k]: t.replace(/\D/g, '') } }))}
          style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, minHeight: 44, textAlign: 'center', fontSize: 16, color: C.ink, backgroundColor: C.card }} /></View>)}</View></Card>)}
  </Screen>;
}
