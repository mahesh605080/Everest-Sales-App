import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useData } from '@/lib/data';
import { C, T } from '@/theme';
import { Card, ErrorBox, Field, H2, Loading, Spread, Sub } from './kit';

/** Choose one of the person's own customers. */
export function CustomerPicker({ title, onPick, only }: { title: string; onPick: (c: any) => void; only?: (c: any) => boolean }) {
  const d = useData<{ rows: any[] }>('/api/m/customers?size=500'); const [q, setQ] = useState('');
  const t = q.trim().toLowerCase(), rows = (d.data?.rows ?? []).filter(x => x.active !== false && (!only || only(x)) && (!t || `${x.name} ${x.code}`.toLowerCase().includes(t)));
  return <><H2>{title}</H2><Field label="Search" value={q} onChangeText={setQ} placeholder="Customer name or code" autoCorrect={false} />
    {!d.data && d.loading && <Loading />}<ErrorBox text={d.error} />
    {d.data && !rows.length && <Sub>No customer matches.</Sub>}
    {rows.slice(0, 40).map(x => <Card key={x.id} onPress={() => onPick(x)}><Spread><View style={{ flex: 1 }}><Text style={T.h2}>{x.name}</Text><Sub>{x.code} · {x.type}{x.town ? ` · ${x.town}` : ''}</Sub></View><Ionicons name="chevron-forward" size={18} color={C.faint} /></Spread></Card>)}</>;
}
export const useCustomerName = (id: string) => { const d = useData<{ rows: any[] }>(id ? '/api/m/customers?size=500' : null); return d.data?.rows.find(x => String(x.id) === id)?.name as string | undefined; };
