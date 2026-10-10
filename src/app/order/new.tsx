import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { fetchCached, useData } from '@/lib/data';
import { newRef, rs } from '@/lib/format';
import { submit } from '@/lib/outbox';
import { Lot, priceLine, Pricing, Product } from '@/lib/pricing';
import { Button, Card, Empty, ErrorBox, Field, H2, Loading, Note, Num, Pill, Row, Screen, Spread, Stale, Stepper, Sub, done } from '@/ui/kit';
import { C, R, S, T } from '@/theme';

const NONE: Pricing = { rates: {}, schemes: [] };

export default function NewOrder() {
  const p = useLocalSearchParams<{ customer?: string; repeat?: string; product?: string; qty?: string; batch?: string; booklet?: string }>(); const router = useRouter();
  const [cust, setCust] = useState(p.customer ?? ''); const [pick, setPick] = useState('');
  const custs = useData<{ rows: any[] }>('/api/m/customers?size=500'), prods = useData<{ rows: Product[] }>('/api/m/products?size=500');
  const pricing = useData<Pricing>(cust ? `/api/pricing?customer=${cust}` : null), credit = useData<{ credit: any }>(cust ? `/api/credit?customer=${cust}` : null);
  const sug = useData<any>(cust ? `/api/sales/suggest?customer=${cust}` : null);
  const bk = useData<{ booklet: any; items: any[] }>(p.booklet ? `/api/booklets/${p.booklet}` : null);
  const [qty, setQty] = useState<Record<number, number>>({}); const [lot, setLot] = useState<Lot & { product_id: number; product: string } | null>(null); const [lotQty, setLotQty] = useState(0);
  const [q, setQ] = useState(''); const [remarks, setRemarks] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [onlyMine, setOnlyMine] = useState(false);
  const [ref] = useState(newRef); // one reference for this order, however many times Submit has to be tried

  const c = custs.data?.rows.find(x => String(x.id) === cust), pr = pricing.data ?? NONE, booklet = bk.data?.booklet?.status === 'Accepted' && String(bk.data.booklet.customer_id) === cust ? bk.data : null;
  // Opened from a suggestion: start with what it proposed.
  useEffect(() => { if (p.product && p.qty) setQty({ [Number(p.product)]: Number(p.qty) || 0 }); }, [p.product, p.qty]);
  useEffect(() => { if (!p.batch) return; fetchCached<{ batch: any }>(`/api/expiry?batch=${p.batch}`).then(r => { const b = r.data.batch; if (!b?.offer) { setNote(`Batch ${b?.batch_no ?? ''} has no near-expiry offer now.`); return; } setLot({ ...b, product_id: b.product_id, product: b.product }); setLotQty(Math.min(Number(p.qty) || b.free_boxes, b.free_boxes)); }).catch(e => setErr(e.message)); }, [p.batch, p.qty]);
  useEffect(() => { if (p.repeat === '1' && cust) repeat(); }, [p.repeat, cust]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (booklet) setQty(Object.fromEntries(booklet.items.map((i: any) => [i.product_id, Math.max(0, i.balance)]))); }, [booklet?.booklet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function repeat() { try { const r = (await fetchCached<any>(`/api/sales/last-order?customer=${cust}`)).data; if (!r.order) { setNote('This customer has no earlier order to repeat.'); return; } setQty(Object.fromEntries(r.items.map((i: any) => [i.product_id, i.qty]))); setOnlyMine(true); setNote(`Filled from ${r.order.no} of ${r.order.order_date}. Rates are today's.`); } catch (e: any) { setErr(e.message); } }
  function suggest() { const s = sug.data; if (!s?.items?.length) { setNote(s?.basis === 'stock' ? `The stock report of ${s.day} shows enough of every product for ${s.target_days} days.` : 'No stock report or order history to suggest from. Report this customer\'s stock first.'); return; }
    setQty(Object.fromEntries(s.items.map((i: any) => [i.product_id, i.qty]))); setOnlyMine(true); setNote(s.basis === 'stock' ? `From the stock report of ${s.day}: fills each product to ${s.target_days} days of sale.` : 'The usual monthly quantity of products not ordered for 30 days.'); }

  const all = prods.data?.rows ?? [];
  const lines = useMemo(() => all.filter(x => (qty[x.id] || 0) > 0).map(x => {
    if (booklet) { const bi = booklet.items.find((i: any) => i.product_id === x.id); return { p: x, qty: qty[x.id], rate: bi?.net_rate ?? 0, free: 0, scheme: null, nudge: null, value: qty[x.id] * x.units_per_box * (bi?.net_rate ?? 0), source: 'booklet' as const }; }
    return { p: x, qty: qty[x.id], ...priceLine(x, qty[x.id], pr) }; }), [all, qty, pr, booklet]);
  const lotP = lot ? all.find(x => x.id === lot.product_id) : null, lotValue = lot && lotP ? lotQty * lotP.units_per_box * lot.offer.rate : 0;
  const value = lines.reduce((a, l) => a + l.value, 0) + lotValue, count = lines.length + (lot && lotQty > 0 ? 1 : 0);
  const cr = credit.data?.credit, over = cr && value > cr.available;
  const shown = (booklet ? all.filter(x => booklet.items.some((i: any) => i.product_id === x.id)) : all).filter(x => (!onlyMine || (qty[x.id] || 0) > 0) && (!q.trim() || `${x.name} ${x.code}`.toLowerCase().includes(q.trim().toLowerCase())));

  async function send() {
    if (!count) { setErr('Enter boxes for at least one product.'); return; }
    setBusy(true); setErr('');
    const items = [...(lot && lotQty > 0 ? [{ product_id: lot.product_id, qty: lotQty, batch_id: lot.id }] : []), ...lines.map(l => ({ product_id: l.p.id, qty: l.qty }))];
    try {
      const r = await submit({ ref, kind: 'order', path: '/api/orders', title: `Order · ${c?.name ?? 'customer'}`, sub: `${count} ${count === 1 ? 'product' : 'products'} · about ${rs(value)}`,
        body: { customer_id: Number(cust), booklet_id: booklet ? booklet.booklet.id : null, client_ref: ref, items, remarks } });
      done(); if (r.queued) router.replace('/outbox'); else router.replace(`/order/${r.data.id}` as any);
    } catch (e: any) { setErr(e?.message ?? 'Could not send the order.'); } finally { setBusy(false); }
  }

  if (!cust) { const t = pick.trim().toLowerCase(), rows = (custs.data?.rows ?? []).filter(x => x.active !== false && (!t || `${x.name} ${x.code}`.toLowerCase().includes(t)));
    return <Screen><H2>Who is the order for?</H2><Field label="Search" value={pick} onChangeText={setPick} placeholder="Customer name or code" autoCorrect={false} />
      {!custs.data && custs.loading && <Loading />}<ErrorBox text={custs.error} />
      {rows.slice(0, 40).map(x => <Card key={x.id} onPress={() => setCust(String(x.id))}><Spread><View style={{ flex: 1 }}><Text style={T.h2}>{x.name}</Text><Sub>{x.code} · {x.type}{x.town ? ` · ${x.town}` : ''}</Sub></View><Ionicons name="chevron-forward" size={18} color={C.faint} /></Spread></Card>)}</Screen>; }

  return <Screen footer={<><Spread><View><Sub>{count} {count === 1 ? 'product' : 'products'}</Sub><Num style={{ fontSize: 20 }}>{rs(value)}</Num></View>{cr && count > 0 && <Pill tone={over ? 'crit' : 'good'}>{over ? 'Over credit limit' : 'Within credit limit'}</Pill>}</Spread>
    <Button title="Send to Credit Control" icon="send" busy={busy} disabled={!count} onPress={send} /></>}>
    <View style={{ gap: 2 }}><Text style={T.h1}>{c?.name ?? 'Customer'}</Text>{cr && <Sub>Available credit {rs(cr.available)} of {rs(cr.credit_limit)}{cr.dda_expired ? ' · DDA licence expired' : ''}</Sub>}</View>
    <Stale show={prods.stale || pricing.stale} at={prods.at || pricing.at} />
    {(prods.stale || pricing.stale) && <Note tone="info" text="You can still write the order. Rates shown are the saved ones; the office confirms the final value when it arrives." />}
    {booklet ? <Note tone="good" text={`Booklet ${booklet.booklet.no}: approved rates, up to the balance of each product.`} />
      : <Row wrap><Button small kind="soft" icon="repeat" title="Repeat last order" onPress={repeat} /><Button small kind="soft" icon="bulb-outline" title="Suggested order" onPress={suggest} />{count > 0 && <Button small kind="plain" title={onlyMine ? 'Show all products' : 'Show only chosen'} onPress={() => setOnlyMine(!onlyMine)} />}</Row>}
    {note ? <Note tone="info" text={note} /> : null}<ErrorBox text={err || prods.error} />

    {lot && lotP && <Card tone="warn"><Pill tone="warn">Near-expiry lot · non-returnable</Pill><Text style={T.h2}>{lot.product}</Text><Sub>Batch {lot.batch_no} · expires {lot.expiry_date} · {lot.offer.text} · {lot.free_boxes} boxes free</Sub>
      <Spread><View><Sub>Rate {lot.offer.rate.toFixed(2)}</Sub><Num>{rs(lotValue)}</Num></View><Stepper label={lot.product} value={lotQty} onChange={n => setLotQty(Math.min(n, lot.free_boxes))} /></Spread></Card>}

    {!booklet && <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, gap: 8 }}>
      <Ionicons name="search" size={18} color={C.faint} /><TextInput accessibilityLabel="Search products" value={q} onChangeText={setQ} placeholder="Search product" placeholderTextColor={C.faint} style={{ flex: 1, minHeight: 46, fontSize: 16, color: C.ink }} autoCorrect={false} /></View>}
    {!prods.data && prods.loading && <Loading />}
    {prods.data && !shown.length && <Card><Empty icon="cube-outline" title="No product matches" /></Card>}
    {shown.map(x => { const n = qty[x.id] || 0, bi = booklet?.items.find((i: any) => i.product_id === x.id), l = booklet ? null : priceLine(x, n, pr), k = sug.data?.stock?.[x.id];
      const rate = booklet ? bi?.net_rate ?? 0 : l!.rate, hint = !booklet && !n ? pr.schemes.find(s => s.product_id === x.id && pr.rates[String(x.id)]?.source !== 'customer') : null;
      const cover = k && k.sold_30d > 0 && n > 0 ? (k.stock + k.coming + n) / k.sold_30d : null, tooMuch = cover != null && cover > (sug.data?.max_cover_months ?? 3);
      return <View key={x.id} style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: n ? C.accent : C.line, padding: S.md, gap: 6 }}>
        <Spread style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}><Text style={[T.body, { fontWeight: '700' }]}>{x.name}</Text><Sub>{x.pack_size || x.code} · Rs {Number(rate).toFixed(2)}{l && l.source !== 'trade' ? (l.source === 'customer' ? ' · contract' : ' · price list') : ''}{bi ? ` · balance ${bi.balance}` : ''}</Sub>{k && <Sub>holds {k.stock}, sells {k.sold_30d} a month</Sub>}</View>
          <Stepper label={x.name} value={n} onChange={v => setQty(o => ({ ...o, [x.id]: bi ? Math.min(v, Math.max(0, bi.balance)) : v }))} /></Spread>
        {(n > 0 || hint) && <Row wrap gap={6}>{n > 0 && <Num>{rs(n * x.units_per_box * rate)}</Num>}{l?.scheme && <Pill tone="good">{l.scheme.text}{l.free ? ` · ${l.free} free` : ''}</Pill>}{l?.nudge && <Pill tone="info">{l.nudge}</Pill>}{hint && <Pill tone="plain">{hint.text} from {hint.min_qty} boxes</Pill>}</Row>}
        {tooMuch && <Sub style={{ color: C.warn, fontWeight: '600' }}>With this the customer holds {cover!.toFixed(1)} months of sale. Extra stock can come back as an expiry return.</Sub>}
      </View>; })}
    <Field label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Delivery note for the office (optional)" />
  </Screen>;
}
