import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { call } from '@/lib/api';
import { useData } from '@/lib/data';
import { appRoute } from '@/lib/links';
import { rs, short, when } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { Button, Card, Choice, Empty, ErrorBox, H2, Loading, Num, Pill, Row, Screen, Spread, Stale, Sub, done, tap } from '@/ui/kit';
import { C, R, S, T } from '@/theme';

const KIND: Record<string, 'warn' | 'good' | 'crit' | 'info'> = { 'Near-expiry lot': 'warn', 'Approved rate': 'good', 'Running low': 'crit', 'Collect payment': 'crit' };
const TONE: Record<string, string> = { crit: C.crit, warn: C.warn, good: C.good };
export default function Today() {
  const { user, can } = useSession(); const router = useRouter(); const out = useOutbox();
  const seller = can('orders.create') || can('sales.view'), field = can('field.use');
  const pulse = useData<{ cards: any[] }>('/api/pulse');
  const acts = useData<{ actions: any[]; total: number; value: number; reasons: string[] }>(seller ? '/api/sales/actions' : null);
  const day = useData<{ open: any; visits: any[] }>(field ? '/api/field/today' : null);
  const [ask, setAsk] = useState<string | null>(null); const [why, setWhy] = useState(''); const [err, setErr] = useState(''); const [all, setAll] = useState(false);
  const reload = useCallback(() => { pulse.refresh(); acts.refresh(); day.refresh(); }, [pulse.refresh, acts.refresh, day.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { reload(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const [flash, setFlash] = useState('');
  useEffect(() => realtime.on(e => { if (e.event === 'notification') { setFlash(e.payload.title); reload(); } else if (e.event === 'notice') setFlash(`New notice: ${e.payload.title}`); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  async function answer(key: string, outcome: 'done' | 'later' | 'no', reason?: string) {
    setErr(''); try { await call('/api/sales/actions', { json: { key, outcome, reason } }); done(); setAsk(null); setWhy(''); acts.refresh(); } catch (e: any) { setErr(e?.message ?? 'Could not save.'); }
  }
  const list = acts.data?.actions ?? [], shown = all ? list : list.slice(0, 6);
  return <Screen onRefresh={reload} refreshing={pulse.loading && !!pulse.data}>
    <View style={{ gap: 2 }}><Text style={T.h1}>Namaste, {user?.name?.split(' ')[0]}</Text><Sub>{user?.role_name}{day.data?.visits?.length ? ` · ${day.data.visits.length} ${day.data.visits.length === 1 ? 'visit' : 'visits'} today` : ''}</Sub></View>
    <Stale show={pulse.stale || acts.stale} at={pulse.at || acts.at} />
    {flash ? <Card tone="good" onPress={() => { setFlash(''); router.push('/notifications'); }}><Row><Ionicons name="notifications" size={18} color={C.good} /><Text style={[T.body, { fontWeight: '700', flex: 1 }]}>{flash}</Text></Row></Card> : null}
    {out.length > 0 && <Card tone="warn" onPress={() => router.push('/outbox')}><Spread><Row><Ionicons name="cloud-upload-outline" size={20} color={C.warn} /><Text style={[T.body, { fontWeight: '700' }]}>{out.length} waiting to send</Text></Row><Ionicons name="chevron-forward" size={18} color={C.faint} /></Spread><Sub>Saved on this phone. They go to the office when there is a connection.</Sub></Card>}
    {day.data?.open && <Card tone="good" onPress={() => router.push('/visit')}><Spread><View style={{ flex: 1 }}><Pill tone="good">Visit in progress</Pill><Text style={[T.h2, { marginTop: 6 }]}>{day.data.open.customer}</Text><Sub>since {when(day.data.open.in_at)} · tap to check out</Sub></View><Ionicons name="chevron-forward" size={20} color={C.faint} /></Spread></Card>}

    {pulse.data && pulse.data.cards.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>{pulse.data.cards.map(c => { const to = appRoute(c.href);
      return <Pressable key={c.k} disabled={!to} onPress={() => { tap(); if (to) router.push(to as any); }} style={{ flexGrow: 1, flexBasis: '46%', backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, gap: 2 }}>
        <Text style={T.label} numberOfLines={2}>{c.label}</Text><Text style={{ fontSize: 22, fontWeight: '800', color: TONE[c.tone] ?? C.ink, ...T.num }}>{c.money ? short(c.value) : c.value}</Text><Sub lines={2}>{c.sub}</Sub></Pressable>; })}</View>}

    {seller && <>
      <Spread style={{ marginTop: S.sm }}><H2>Do these first</H2>{acts.data ? <Sub>{acts.data.total} worth {short(acts.data.value)}</Sub> : null}</Spread>
      <ErrorBox text={err || acts.error} />
      {!acts.data && acts.loading && <Loading />}
      {acts.data && !list.length && <Card><Empty title="Nothing is waiting" text="Every chance has been taken or answered." /></Card>}
      {shown.map((a, i) => { const to = appRoute(a.href);
        return <Card key={a.key}>
          <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 4 }}><Text style={T.h2}>{i + 1}. {a.customer}</Text><Row wrap gap={6}><Pill tone={a.cls === 'A' ? 'good' : a.cls === 'B' ? 'info' : 'plain'}>Class {a.cls}</Pill><Pill tone={KIND[a.kind] ?? 'info'}>{a.kind}</Pill></Row></View><Num>{rs(a.value)}</Num></Spread>
          <Sub>{a.text}</Sub>
          {ask === a.key ? <View style={{ gap: S.sm }}><Choice label="Why not?" options={acts.data!.reasons} value={why as any} onChange={setWhy} /><Row><Button small title="Save" disabled={!why} onPress={() => answer(a.key, 'no', why)} /><Button small kind="plain" title="Cancel" onPress={() => { setAsk(null); setWhy(''); }} /></Row></View>
            : <Row wrap>{to && (can('orders.create') || a.cta !== 'Create order') && <Button small title={a.cta} onPress={() => router.push(to as any)} />}
              {can('orders.create') && <><Button small kind="plain" title="Done" onPress={() => answer(a.key, 'done')} /><Button small kind="plain" title="Later" onPress={() => answer(a.key, 'later')} /><Button small kind="plain" title="Not interested" onPress={() => { setAsk(a.key); setWhy(''); }} /></>}</Row>}
        </Card>; })}
      {list.length > 6 && <Button kind="soft" title={all ? 'Show the first 6' : `Show all ${list.length}`} onPress={() => setAll(!all)} />}
    </>}
  </Screen>;
}
