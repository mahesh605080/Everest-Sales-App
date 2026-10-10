import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { ago, rs, short } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Loading, Num, Pill, Row, Screen, Spread, Stale, Sub, done } from '@/ui/kit';
import { C, R, T } from '@/theme';

export default function Approvals() {
  const d = useData<{ items: any[]; value: number }>('/api/approvals');
  const [rm, setRm] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useFocusEffect(useCallback(() => { d.refresh(); }, [d.refresh]));
  async function act(i: any, yes: boolean) {
    setBusy(i.key + yes); setErr('');
    try { await call(i.url, { json: { ...(yes ? i.ok : i.no), remarks: rm[i.key] || '' } }); done(); await d.refresh(); }
    catch (e: any) { setErr(`${i.title}: ${e?.message ?? 'could not save'}`); } finally { setBusy(''); }
  }
  const items = d.data?.items ?? [];
  return <Screen onRefresh={d.refresh} refreshing={d.loading && !!d.data}>
    {d.data && <Sub>{items.length} waiting for you{d.data.value ? ` · ${short(d.data.value)} held up` : ''} · oldest first</Sub>}
    <Stale show={d.stale} at={d.at} /><ErrorBox text={err || d.error} />
    {!d.data && d.loading && <Loading />}
    {d.data && !items.length && <Card><Empty title="Nothing is waiting for you" /></Card>}
    {items.map(i => <Card key={i.key} tone={i.warn ? 'warn' : undefined}>
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 2 }}><Text style={T.h2}>{i.title}</Text><Sub>{i.type} · {i.sub}</Sub></View>{i.value != null && <Num>{rs(i.value)}</Num>}</Spread>
      <Row wrap gap={6}><Pill>{ago(new Date(i.at).getTime())}</Pill></Row>
      {i.note ? <Sub style={i.warn ? { color: C.warn, fontWeight: '600' } : undefined}>{i.note}</Sub> : null}
      <TextInput accessibilityLabel={`Remarks for ${i.title}`} value={rm[i.key] || ''} onChangeText={t => setRm(o => ({ ...o, [i.key]: t }))} placeholder={i.warn ? 'Remarks (needed)' : 'Remarks (needed to reject)'} placeholderTextColor={C.faint}
        style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, minHeight: 44, paddingHorizontal: 12, fontSize: 15, color: C.ink }} />
      <Row><Button style={{ flex: 1 }} title={i.okLabel || 'Approve'} busy={busy === i.key + true} disabled={!!busy || d.stale} onPress={() => act(i, true)} /><Button style={{ flex: 1 }} kind="danger" title="Reject" busy={busy === i.key + false} disabled={!!busy || d.stale} onPress={() => act(i, false)} /></Row>
    </Card>)}
  </Screen>;
}
