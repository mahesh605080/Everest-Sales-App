import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useData } from '@/lib/data';
import { km } from '@/lib/format';
import { Fix, quickFix } from '@/lib/location';
import { prepareOffline } from '@/lib/prefetch';
import { useSession } from '@/lib/session';
import { Card, Empty, ErrorBox, Loading, Pill, Row, Screen, Spread, Stale, Sub } from '@/ui/kit';
import { C, R, T } from '@/theme';

const metres = (a: Fix, lat: number, lng: number) => { const r = Math.PI / 180, x = (lng - a.lng) * r * Math.cos(((a.lat + lat) / 2) * r), y = (lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371000; };

export default function Customers() {
  const router = useRouter(); const { can } = useSession(); const field = can('field.use');
  // A field person gets the day's list (planned visits, last visit); everyone else gets their territory.
  const day = useData<{ customers: any[]; open: any }>(field ? '/api/field/today' : null);
  const all = useData<{ rows: any[] }>(field ? null : '/api/m/customers?size=500');
  const [q, setQ] = useState(''); const [me, setMe] = useState<Fix | null>(null);
  useEffect(() => { quickFix().then(setMe); }, []);
  useFocusEffect(useCallback(() => { day.refresh(); all.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const src = field ? day : all, rows: any[] = (field ? day.data?.customers : all.data?.rows) ?? [];
  useEffect(() => { if (can('orders.create') && rows.length && !src.stale) prepareOffline(rows.map(c => c.id)); }, [rows.length, src.stale]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const withD = rows.map(c => ({ ...c, d: me && c.lat != null && c.lng != null ? metres(me, c.lat, c.lng) : null }));
    return withD.filter(c => !t || `${c.name} ${c.code} ${c.town ?? ''}`.toLowerCase().includes(t)).sort((a, b) => Number(b.planned ?? 0) - Number(a.planned ?? 0) || (a.d ?? 1e12) - (b.d ?? 1e12) || a.name.localeCompare(b.name));
  }, [rows, q, me]);
  return <Screen onRefresh={() => { src.refresh(); quickFix().then(setMe); }} refreshing={src.loading && !!src.data}>
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, gap: 8 }}>
      <Ionicons name="search" size={18} color={C.faint} /><TextInput accessibilityLabel="Search customers" value={q} onChangeText={setQ} placeholder="Search name, code or town" placeholderTextColor={C.faint} style={{ flex: 1, minHeight: 46, fontSize: 16, color: C.ink }} autoCorrect={false} /></View>
    <Stale show={src.stale} at={src.at} /><ErrorBox text={src.error} />
    {!src.data && src.loading && <Loading />}
    {src.data && !list.length && <Card><Empty icon="people-outline" title={rows.length ? 'No customer matches' : 'No customers assigned yet'} text={rows.length ? undefined : 'Ask your manager to assign customers to you.'} /></Card>}
    {list.map(c => <Card key={c.id} onPress={() => router.push(`/customer/${c.id}` as any)}>
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 3 }}><Text style={T.h2}>{c.name}</Text><Sub>{c.code} · {c.type}{c.town ? ` · ${c.town}` : ''}</Sub></View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>{c.d != null && <Text style={[T.sub, { fontWeight: '700', color: C.accentDark }]}>{km(c.d)}</Text>}<Ionicons name="chevron-forward" size={18} color={C.faint} /></View></Spread>
      <Row wrap gap={6}>{c.planned && <Pill tone="info">Planned today</Pill>}{day.data?.open?.customer_id === c.id && <Pill tone="good">Visit in progress</Pill>}{c.lat == null && <Pill tone="warn">No location yet</Pill>}
        {field && <Sub>{c.last_visit ? `last visit ${new Date(c.last_visit).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'never visited'}</Sub>}</Row>
    </Card>)}
  </Screen>;
}
