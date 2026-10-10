import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { when } from '@/lib/format';
import { quickFix } from '@/lib/location';
import { Button, Card, Choice, Empty, ErrorBox, Field, Loading, Pill, Row, Screen, Sub, done } from '@/ui/kit';
import { T } from '@/theme';

export default function Visit() {
  const router = useRouter(); const day = useData<{ open: any; purposes: string[] }>('/api/field/today');
  const [purpose, setPurpose] = useState(''); const [met, setMet] = useState(''); const [remarks, setRemarks] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function out() {
    if (!purpose) { setErr('Choose the purpose of the visit.'); return; }
    if (remarks.trim().length < 10) { setErr('Write what happened, in at least 10 characters.'); return; }
    setBusy(true); setErr('');
    try { const f = await quickFix(); await call('/api/field/visit/end', { json: { purpose, person_met: met, remarks, lat: f?.lat, lng: f?.lng, accuracy: f?.accuracy } }); done(); router.back(); }
    catch (e: any) { setErr(e?.message ?? 'Could not check out.'); } finally { setBusy(false); }
  }
  if (!day.data) return <Screen>{day.loading ? <Loading /> : <ErrorBox text={day.error} />}</Screen>;
  const v = day.data.open;
  if (!v) return <Screen><Card><Empty icon="walk-outline" title="No visit is open" text="Open a customer and tap Check in here." /></Card></Screen>;
  return <Screen footer={<Button title="Check out" icon="exit-outline" busy={busy} onPress={out} />}>
    <Card><Pill tone="good">Visit in progress</Pill><Text style={T.h1}>{v.customer}</Text><Sub>checked in {when(v.in_at)}{v.distance_m != null ? ` · ${v.distance_m} m from the saved location` : ''}</Sub>
      {v.out_of_fence && <Pill tone="crit">Outside the allowed distance</Pill>}
      <Row wrap><Button small kind="soft" title="Take order" icon="add" onPress={() => router.push(`/order/new?customer=${v.customer_id}` as any)} /><Button small kind="soft" title="Collection" icon="cash-outline" onPress={() => router.push(`/collection?customer=${v.customer_id}` as any)} /><Button small kind="soft" title="Stock" icon="cube-outline" onPress={() => router.push(`/stock?customer=${v.customer_id}` as any)} /></Row></Card>
    <Card style={{ gap: 14 }}>
      <Choice label="Purpose" options={day.data.purposes} value={purpose as any} onChange={setPurpose} />
      <Field label="Person met" value={met} onChangeText={setMet} placeholder="Name" />
      <Field label="What happened" value={remarks} onChangeText={setRemarks} multiline placeholder="Order taken, payment promised for Friday…" help="At least 10 characters." />
      <ErrorBox text={err} />
    </Card>
  </Screen>;
}
