import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { appRoute } from '@/lib/links';
import { when } from '@/lib/format';
import { Card, Empty, ErrorBox, Loading, Screen, Stale, Sub } from '@/ui/kit';
import { C, T } from '@/theme';

export default function Notifications() {
  const d = useData<{ unread: number; items: any[] }>('/api/notifications'); const router = useRouter();
  useEffect(() => { if (d.data?.unread && !d.stale) call('/api/notifications', { json: { id: 'all' } }).catch(() => {}); }, [d.data?.unread, d.stale]);
  return <Screen onRefresh={d.refresh} refreshing={d.loading && !!d.data}>
    <Stale show={d.stale} at={d.at} /><ErrorBox text={d.error} />{!d.data && d.loading && <Loading />}
    {d.data && !d.data.items.length && <Card><Empty icon="notifications-outline" title="Nothing yet" text="Approvals and decisions on your orders appear here." /></Card>}
    {d.data?.items.map(n => { const to = n.link === '/orders' ? '/orders' : appRoute(n.link || '');
      return <Card key={n.id} onPress={to ? () => router.push(to as any) : undefined}><View style={{ flexDirection: 'row', gap: 10 }}>{!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 7 }} />}
        <View style={{ flex: 1, gap: 2 }}><Text style={[T.body, { fontWeight: n.read ? '500' : '700' }]}>{n.title}</Text>{n.body ? <Sub>{n.body}</Sub> : null}<Sub>{when(n.at)}</Sub></View></View></Card>; })}
  </Screen>;
}
