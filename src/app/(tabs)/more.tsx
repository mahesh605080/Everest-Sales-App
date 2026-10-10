import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, Switch, Text, View } from 'react-native';
import { useData } from '@/lib/data';
import { dutyOn, startDuty, stopDuty } from '@/lib/location';
import { useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorBox, H2, Line, Pill, Screen, Spread, Sub, tap } from '@/ui/kit';
import { C, T } from '@/theme';
import Constants from 'expo-constants';

function Item({ icon, title, sub, badge, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; badge?: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={() => { tap(); onPress(); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, pressed && { opacity: 0.6 }]}>
    <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={C.accentDark} /></View>
    <View style={{ flex: 1 }}><Text style={[T.body, { fontWeight: '600' }]}>{title}</Text>{sub ? <Sub>{sub}</Sub> : null}</View>
    {badge ? <Pill tone="warn">{badge}</Pill> : null}<Ionicons name="chevron-forward" size={18} color={C.faint} /></Pressable>;
}

export default function More() {
  const { user, can, signOut, server } = useSession(); const router = useRouter(); const out = useOutbox();
  const notes = useData<{ unread: number }>('/api/notifications');
  const chats = useData<{ rooms: any[] }>(can('chat.use') ? '/api/v1/chat/rooms' : null);
  const [duty, setDuty] = useState(false); const [err, setErr] = useState('');
  useFocusEffect(useCallback(() => { dutyOn().then(setDuty); notes.refresh(); chats.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  async function toggle(v: boolean) { setErr(''); try { if (v) await startDuty(); else await stopDuty(); setDuty(await dutyOn()); } catch (e: any) { setErr(e?.message ?? 'Could not change route recording.'); setDuty(await dutyOn()); } }
  function leave() {
    const text = out.length ? `${out.length} ${out.length === 1 ? 'item is' : 'items are'} still waiting to be sent and will be deleted from this phone.` : 'You will need your password to log in again.';
    if (Platform.OS === 'web') { signOut(); return; }
    Alert.alert('Log out?', text, [{ text: 'Stay', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => { signOut(); } }]);
  }
  return <Screen>
    <Card><Spread><View style={{ flex: 1 }}><Text style={T.h2}>{user?.name}</Text><Sub>{user?.code} · {user?.role_name}</Sub></View><View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.accentDark, fontWeight: '800' }}>{user?.name?.split(' ').map(x => x[0]).slice(0, 2).join('')}</Text></View></Spread></Card>

    {can('track.send') && <Card><Spread><View style={{ flex: 1 }}><H2>On duty</H2><Sub>Records today's route for your manager, also while the phone is in your pocket. Switch it off when the day ends.</Sub></View><Switch accessibilityLabel="On duty: record my route" value={duty} onValueChange={toggle} trackColor={{ true: C.accent, false: C.line }} /></Spread><ErrorBox text={err} /></Card>}

    <Card style={{ gap: 0 }}>
      <Item icon="cloud-upload-outline" title="Waiting to send" sub="Orders and entries saved without a connection" badge={out.length || undefined} onPress={() => router.push('/outbox')} /><Line />
      {can('chat.use') && <><Item icon="chatbubbles-outline" title="Chat" sub="Write to colleagues" badge={chats.data?.rooms.reduce((n: number, r: any) => n + r.unread, 0) || undefined} onPress={() => router.push('/chat' as any)} /><Line /></>}
      <Item icon="notifications-outline" title="Notifications" badge={notes.data?.unread || undefined} onPress={() => router.push('/notifications')} />
      {can('inventory.view') && <><Line /><Item icon="pricetags-outline" title="Near-expiry offers" sub="Lots your customers can use in time" onPress={() => router.push('/offers')} /></>}
      {can('collections.create') && <><Line /><Item icon="cash-outline" title="Record a collection" onPress={() => router.push('/collection')} /></>}
      {can('stock.report') && <><Line /><Item icon="cube-outline" title="Report distributor stock" onPress={() => router.push('/stock')} /></>}
    </Card>
    <Card style={{ gap: 0 }}><Item icon="key-outline" title="Change password" onPress={() => router.push('/password')} /></Card>
    <Button kind="danger" title="Log out" icon="log-out-outline" onPress={leave} />
    <Sub style={{ textAlign: 'center' }}>Everest Sales {Constants.expoConfig?.version ?? ''}{server ? ` · ${server.replace(/^https?:\/\//, '')}` : ''}</Sub>
  </Screen>;
}
