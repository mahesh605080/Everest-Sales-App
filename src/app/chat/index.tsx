import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { Button, Card, Empty, ErrorBox, Field, Loading, Pill, Row, Screen, Spread, Stale, Sub } from '@/ui/kit';
import { T } from '@/theme';

export default function Chats() {
  const router = useRouter(); const { user } = useSession(); const d = useData<{ rooms: any[] }>('/api/v1/chat/rooms');
  const [finding, setFinding] = useState(false); const [q, setQ] = useState(''); const [people, setPeople] = useState<any[]>([]); const [err, setErr] = useState(''); const [live, setLive] = useState('closed');
  useFocusEffect(useCallback(() => { d.refresh(); }, [d.refresh]));
  useEffect(() => { const a = realtime.onState(setLive), b = realtime.on(e => { if (e.event.startsWith('chat.')) d.refresh(); }); return () => { a(); b(); }; }, [d.refresh]);
  useEffect(() => { if (!finding) return; const t = setTimeout(() => call(`/api/v1/chat/people?q=${encodeURIComponent(q)}`).then(r => setPeople(r.people)).catch(e => setErr(e.message)), 200); return () => clearTimeout(t); }, [q, finding]);
  async function start(u: any) { try { const r = await call('/api/v1/chat/rooms', { json: { user_ids: [u.id] } }); setFinding(false); router.push(`/chat/${r.id}` as any); } catch (e: any) { setErr(e.message); } }
  return <Screen onRefresh={d.refresh} refreshing={d.loading && !!d.data}>
    <Spread><Pill tone={live === 'open' ? 'good' : 'warn'}>{live === 'open' ? 'Live' : 'Reconnecting…'}</Pill><Button small kind={finding ? 'plain' : 'primary'} title={finding ? 'Cancel' : 'New conversation'} icon={finding ? undefined : 'create-outline'} onPress={() => { setFinding(!finding); setQ(''); }} /></Spread>
    <Stale show={d.stale} at={d.at} /><ErrorBox text={err || d.error} />
    {finding && <><Field label="Find a colleague" value={q} onChangeText={setQ} placeholder="Name or code" autoCorrect={false} />
      {people.map(u => <Card key={u.id} onPress={() => start(u)}><Spread><View style={{ flex: 1 }}><Text style={T.h2}>{u.name}</Text><Sub>{u.code} · {u.role}</Sub></View>{u.online && <Pill tone="good">online</Pill>}</Spread></Card>)}</>}
    {!finding && !d.data && d.loading && <Loading />}
    {!finding && d.data && !d.data.rooms.length && <Card><Empty icon="chatbubbles-outline" title="No conversations yet" text="Start one with New conversation." /></Card>}
    {!finding && d.data?.rooms.map(r => <Card key={r.id} onPress={() => router.push(`/chat/${r.id}` as any)}>
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 2 }}><Row gap={6}><Text style={T.h2}>{r.title}</Text>{r.members.some((m: any) => m.id !== user?.id && m.online) && <Pill tone="good">online</Pill>}</Row>
        <Sub lines={2}>{r.last ? `${r.last.sender_id === user?.id ? 'You: ' : ''}${r.last.text}` : 'No messages yet'}</Sub></View>{r.unread > 0 && <Pill tone="crit">{r.unread}</Pill>}</Spread></Card>)}
  </Screen>;
}
