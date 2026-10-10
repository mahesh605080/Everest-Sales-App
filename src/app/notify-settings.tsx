import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, Switch, Text, View } from 'react-native';
import { call } from '@/lib/api';
import { askPermission, permission, Permission } from '@/lib/notify';
import { Button, Card, ErrorBox, Field, H2, Line, Loading, Note, Row, Screen, Spread, Sub } from '@/ui/kit';
import { C, T } from '@/theme';

const LABEL: Record<string, string> = { general: 'General', orders: 'Orders and credit', approvals: 'Approvals', collections: 'Collections', stock: 'Stock and expiry', chat: 'Chat', announcements: 'Announcements' };
type Prefs = { push_enabled: boolean; muted_categories: string[]; quiet_from: string | null; quiet_to: string | null; categories: string[] };

export default function NotifySettings() {
  const [perm, setPerm] = useState<Permission | null>(null); const [p, setP] = useState<Prefs | null>(null); const [err, setErr] = useState(''); const [apple, setApple] = useState(false);
  useFocusEffect(useCallback(() => {
    permission().then(setPerm); call<Prefs>('/api/v1/notifications/preferences').then(setP).catch(e => setErr(e.message));
    call<{ apns: { enabled: boolean } }>('/api/v1/push/config').then(c => setApple(c.apns.enabled)).catch(() => {});
  }, []));
  async function save(next: Prefs) {
    setP(next); setErr('');
    try { setP(await call<Prefs>('/api/v1/notifications/preferences', { method: 'PUT', json: { push_enabled: next.push_enabled, muted_categories: next.muted_categories, quiet_from: next.quiet_from || null, quiet_to: next.quiet_to || null } })); }
    catch (e: any) { setErr(e.message); }
  }
  const instant = Platform.OS === 'ios' && apple;
  return <Screen>
    <ErrorBox text={err} />
    <Card>
      <H2>On this phone</H2>
      {perm === 'granted' && <Note tone="good" text="Notifications are allowed." />}
      {perm === 'ask' && <><Sub>Allow notifications so approvals, orders and messages show on the phone.</Sub><Button title="Allow notifications" icon="notifications-outline" onPress={async () => setPerm(await askPermission())} /></>}
      {perm === 'denied' && <><Note tone="warn" text="Notifications are switched off for this app in the phone settings." /><Button kind="plain" title="Open phone settings" onPress={() => Linking.openSettings()} /></>}
      {perm === 'unsupported' && <Sub>Phone notifications work in the installed app, not in this preview.</Sub>}
      <Sub>{instant
        ? 'On this iPhone notifications arrive straight away, also when the app is closed.'
        : 'While the app is open, and while "On duty" is on, notifications arrive within moments. With the app closed the phone checks from time to time (about every 15 minutes, later in battery saver), so they can be late. Keep "On duty" on during work to get them quickly.'}</Sub>
    </Card>
    {!p ? <Loading /> : <>
      <Card><Spread><View style={{ flex: 1 }}><H2>Notify my devices</H2><Sub>When off, everything still waits for you under Notifications.</Sub></View>
        <Switch accessibilityLabel="Notify my devices" value={p.push_enabled} onValueChange={v => save({ ...p, push_enabled: v })} trackColor={{ true: C.accent, false: C.line }} /></Spread></Card>
      <Card style={{ gap: 0 }}><H2>Tell me about</H2>
        {p.categories.map((c, i) => <View key={c}>{i > 0 && <Line />}<Spread style={{ paddingVertical: 8 }}><Text style={T.body}>{LABEL[c] ?? c}</Text>
          <Switch accessibilityLabel={LABEL[c] ?? c} value={!p.muted_categories.includes(c)} onValueChange={v => save({ ...p, muted_categories: v ? p.muted_categories.filter(x => x !== c) : [...p.muted_categories, c] })} trackColor={{ true: C.accent, false: C.line }} /></Spread></View>)}</Card>
      <Card><H2>Quiet hours</H2><Sub>Nepal time, 24-hour clock. Urgent notifications still come through.</Sub>
        <Row><View style={{ flex: 1 }}><Field label="From" placeholder="21:00" value={p.quiet_from ?? ''} onChangeText={v => setP({ ...p, quiet_from: v })} keyboardType="numbers-and-punctuation" maxLength={5} /></View>
          <View style={{ flex: 1 }}><Field label="To" placeholder="07:00" value={p.quiet_to ?? ''} onChangeText={v => setP({ ...p, quiet_to: v })} keyboardType="numbers-and-punctuation" maxLength={5} /></View></Row>
        <Row><Button small title="Save" onPress={() => save(p)} />{(p.quiet_from || p.quiet_to) ? <Button small kind="plain" title="Clear" onPress={() => save({ ...p, quiet_from: null, quiet_to: null })} /> : null}</Row></Card>
    </>}
  </Screen>;
}
