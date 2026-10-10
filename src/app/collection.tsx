import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { newRef, rs } from '@/lib/format';
import { submit } from '@/lib/outbox';
import { Button, Card, Choice, ErrorBox, Field, Screen, Sub, done } from '@/ui/kit';
import { CustomerPicker, useCustomerName } from '@/ui/picker';
import { T } from '@/theme';

const MODES = ['Cash', 'Cheque', 'Bank transfer', 'Online'] as const;
export default function Collection() {
  const p = useLocalSearchParams<{ customer?: string }>(); const router = useRouter();
  const [cust, setCust] = useState(p.customer ?? ''); const name = useCustomerName(cust);
  const [mode, setMode] = useState<(typeof MODES)[number] | ''>('Cash'); const [amount, setAmount] = useState(''); const [refNo, setRefNo] = useState(''); const [bank, setBank] = useState(''); const [cheque, setCheque] = useState(''); const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ref] = useState(newRef);
  async function save() {
    const amt = Number(amount.replace(/,/g, ''));
    if (!mode) { setErr('Choose how the money was received.'); return; }
    if (!(amt > 0)) { setErr('Enter the amount received.'); return; }
    if (mode === 'Cheque' && (!refNo.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(cheque))) { setErr('A cheque needs its number and its date as 2026-10-15.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await submit({ ref, kind: 'collection', path: '/api/req/collections', title: `Collection · ${name ?? 'customer'}`, sub: `${mode} · ${rs(amt)}`,
        body: { customer_id: Number(cust), mode, amount: amt, ref_no: refNo.trim() || null, bank: bank.trim() || null, cheque_date: mode === 'Cheque' ? cheque : null, remarks: remarks.trim() || null, client_ref: ref } });
      done(); if (r.queued) router.replace('/outbox'); else router.back();
    } catch (e: any) { setErr(e?.message ?? 'Could not save the collection.'); } finally { setBusy(false); }
  }
  if (!cust) return <Screen><CustomerPicker title="Who paid?" onPick={c => setCust(String(c.id))} /></Screen>;
  return <Screen footer={<Button title="Save collection" icon="checkmark" busy={busy} onPress={save} />}>
    <Text style={T.h1}>{name ?? 'Customer'}</Text><Sub>Credit Control checks it against the bank or cash book.</Sub>
    <Card style={{ gap: 14 }}>
      <Choice label="Received by" options={MODES} value={mode} onChange={setMode} />
      <Field label="Amount (Rs)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      {mode !== 'Cash' && <Field label={mode === 'Cheque' ? 'Cheque number' : 'Reference number'} value={refNo} onChangeText={setRefNo} autoCapitalize="characters" />}
      {mode !== 'Cash' && <Field label="Bank" value={bank} onChangeText={setBank} />}
      {mode === 'Cheque' && <Field label="Cheque date" value={cheque} onChangeText={setCheque} placeholder="2026-10-15" keyboardType="numbers-and-punctuation" help="Year-month-day." />}
      <Field label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Optional" />
      <ErrorBox text={err} />
    </Card>
  </Screen>;
}
