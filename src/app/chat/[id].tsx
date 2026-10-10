import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { call } from '@/lib/api';
import { newRef, when } from '@/lib/format';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { Button, ErrorBox, Loading, Sub } from '@/ui/kit';
import { C, R, S, T } from '@/theme';

export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { user } = useSession(); const nav = useNavigation(); const inset = useSafeAreaInsets();
  const [d, setD] = useState<any>(null); const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const list = useRef<ScrollView>(null);
  const me = user?.id;
  useEffect(() => {
    let alive = true;
    const load = () => call(`/api/v1/chat/rooms/${id}/messages`).then(r => { if (!alive) return; setD(r); nav.setOptions({ title: r.room.name || r.members.filter((m: any) => m.user_id !== me).map((m: any) => m.name).join(', ') }); call(`/api/v1/chat/rooms/${id}/read`, { method: 'POST' }).catch(() => {}); }).catch(e => alive && setErr(e.message));
    load();
    const off = realtime.on(e => {
      if (e.payload?.room !== id) return;
      if (e.event === 'chat.message') { setD((x: any) => x && !x.messages.some((m: any) => m.id === e.payload.id) ? { ...x, messages: [...x.messages, e.payload] } : x); if (e.payload.sender_id !== me) call(`/api/v1/chat/rooms/${id}/read`, { method: 'POST' }).catch(() => {}); }
      else if (e.event === 'chat.receipt') setD((x: any) => x ? { ...x, members: x.members.map((m: any) => m.user_id === e.payload.user_id ? { ...m, last_delivered_id: e.payload.delivered_id, last_read_id: e.payload.read_id } : m) } : x);
    });
    const offS = realtime.onState(s => { if (s === 'open') load(); }); // after a reconnect, fetch what was missed in this conversation
    return () => { alive = false; off(); offS(); };
  }, [id, me]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    const body = text.trim(); if (!body) return; setBusy(true); setErr(''); setText('');
    try { const m = await call(`/api/v1/chat/rooms/${id}/messages`, { json: { text: body, client_id: newRef() } }); setD((x: any) => x && !x.messages.some((y: any) => y.id === m.id) ? { ...x, messages: [...x.messages, m] } : x); }
    catch (e: any) { setErr(e?.message ?? 'Could not send.'); setText(body); } finally { setBusy(false); }
  }
  if (!d) return <View style={{ flex: 1, backgroundColor: C.bg }}>{err ? <View style={{ padding: S.lg }}><ErrorBox text={err} /></View> : <Loading />}</View>;
  const others = d.members.filter((m: any) => m.user_id !== me);
  const tick = (mid: number) => others.every((m: any) => m.last_read_id >= mid) ? 'Read' : others.every((m: any) => m.last_delivered_id >= mid) ? 'Delivered' : 'Sent';
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <ScrollView ref={list} contentContainerStyle={{ padding: S.lg, gap: S.sm }} onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}>
      {!d.messages.length && <Sub style={{ textAlign: 'center' }}>Say hello.</Sub>}
      {d.messages.map((m: any, i: number) => { const mine = m.sender_id === me, lastMine = mine && !d.messages.slice(i + 1).some((x: any) => x.sender_id === me);
        return <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', gap: 2 }}>
          {!mine && d.members.length > 2 && <Text style={T.label}>{d.members.find((x: any) => x.user_id === m.sender_id)?.name}</Text>}
          <View style={{ backgroundColor: mine ? C.accent : C.card, borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 8, borderWidth: mine ? 0 : 1, borderColor: C.line }}><Text style={{ color: mine ? '#fff' : C.ink, fontSize: 15, lineHeight: 21 }}>{m.text}</Text></View>
          <Text style={[T.sub, { fontSize: 11, textAlign: mine ? 'right' : 'left' }]}>{when(m.at)}{lastMine ? ` · ${tick(m.id)}` : ''}</Text></View>; })}
    </ScrollView>
    {err ? <View style={{ paddingHorizontal: S.lg }}><ErrorBox text={err} /></View> : null}
    <View style={{ flexDirection: 'row', gap: 8, padding: S.md, paddingBottom: Math.max(inset.bottom, S.md), backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, alignItems: 'flex-end' }}>
      <TextInput accessibilityLabel="Message" value={text} onChangeText={setText} placeholder="Write a message" placeholderTextColor={C.faint} multiline maxLength={4000}
        style={{ flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink }} />
      <Button title="Send" icon="send" busy={busy} disabled={!text.trim()} onPress={send} /></View>
  </KeyboardAvoidingView>;
}
