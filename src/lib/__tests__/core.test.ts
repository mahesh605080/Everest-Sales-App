import { enqueue, flush, OutItem, refused, remove, retry, waiting } from '../outbox-core';
import { priceLine, Pricing, Product } from '../pricing';
import { cleanBase } from '../url';
import { singleFlight } from '../flight';

const item = (ref: string) => ({ ref, kind: 'order' as const, path: '/api/orders', body: { client_ref: ref }, title: 'Order', sub: '' });

describe('outbox', () => {
  test('the same reference is queued once', () => { let l: OutItem[] = []; l = enqueue(l, item('a')); l = enqueue(l, item('a')); expect(l).toHaveLength(1); });
  test('everything is sent in order when online', async () => {
    const seen: string[] = []; const l = ['a', 'b', 'c'].reduce((acc, r) => enqueue(acc, item(r)), [] as OutItem[]);
    const r = await flush(l, async it => { seen.push(it.ref); return { ok: true, data: {} }; });
    expect(seen).toEqual(['a', 'b', 'c']); expect(r.list).toHaveLength(0); expect(r.sent).toHaveLength(3);
  });
  test('losing the connection keeps the rest and stops', async () => {
    const l = ['a', 'b', 'c'].reduce((acc, r) => enqueue(acc, item(r)), [] as OutItem[]); let n = 0;
    const r = await flush(l, async () => (++n === 1 ? { ok: true, data: {} } : { ok: false, offline: true, message: 'x' }));
    expect(n).toBe(2); expect(r.stopped).toBe(true); expect(r.list.map(x => x.ref)).toEqual(['b', 'c']); expect(r.list[0].error).toBeUndefined(); expect(waiting(r.list)).toBe(2);
  });
  test('a refusal is kept with its reason and not retried by itself', async () => {
    const l = ['a', 'b'].reduce((acc, r) => enqueue(acc, item(r)), [] as OutItem[]);
    const r = await flush(l, async it => (it.ref === 'a' ? { ok: false, offline: false, message: 'only 20 boxes left' } : { ok: true, data: {} }));
    expect(r.list).toHaveLength(1); expect(r.list[0].error).toBe('only 20 boxes left'); expect(refused(r.list)).toBe(1);
    let calls = 0; const again = await flush(r.list, async () => { calls++; return { ok: true, data: {} }; }); expect(calls).toBe(0); expect(again.list).toHaveLength(1);
    const after = await flush(retry(r.list, 'a'), async () => ({ ok: true, data: {} })); expect(after.list).toHaveLength(0);
    expect(remove(r.list, 'a')).toHaveLength(0);
  });
});

describe('price on the order screen', () => {
  const p: Product = { id: 1, code: 'RL500', name: 'RL', units_per_box: 24, trade_rate: 66 };
  const s = { id: 9, code: 'RL-10P1', product_id: 1, min_qty: 20, bonus_buy: 10, bonus_free: 1, discount_pct: 0, text: '10+1' };
  const none: Pricing = { rates: {}, schemes: [] }, withScheme: Pricing = { rates: {}, schemes: [s] };
  test('trade rate when nothing else applies', () => { const l = priceLine(p, 10, none); expect(l.rate).toBe(66); expect(l.free).toBe(0); expect(l.value).toBe(10 * 24 * 66); });
  test('scheme gives free boxes from the minimum', () => { expect(priceLine(p, 19, withScheme).free).toBe(0); expect(priceLine(p, 28, withScheme).free).toBe(2); });
  test('nudge to the next free box', () => { expect(priceLine(p, 28, withScheme).nudge).toBe('2 more boxes for 1 more free'); expect(priceLine(p, 15, withScheme).nudge).toBe('5 more boxes for 10+1'); expect(priceLine(p, 24, withScheme).nudge).toBeNull(); });
  test('discount lowers the rate', () => { const l = priceLine(p, 25, { rates: {}, schemes: [{ ...s, discount_pct: 5 }] }); expect(l.rate).toBeCloseTo(62.7, 4); expect(l.free).toBe(2); });
  test('price list rate, and a contract rate takes no scheme', () => {
    expect(priceLine(p, 30, { rates: { '1': { rate: 60, source: 'type' } }, schemes: [s] })).toMatchObject({ rate: 60, free: 3, source: 'type' });
    expect(priceLine(p, 30, { rates: { '1': { rate: 58, source: 'customer' } }, schemes: [s] })).toMatchObject({ rate: 58, free: 0, source: 'customer' });
  });
  test('a near-expiry lot uses its offer rate', () => { const l = priceLine(p, 5, withScheme, { id: 3, batch_no: 'B1', expiry_date: '2027-01-01', free_boxes: 50, offer: { rate: 46.2, text: '30% off' } }); expect(l.rate).toBe(46.2); expect(l.free).toBe(0); });
});

test('server address is tidied', () => {
  expect(cleanBase(' sales.example.com/ ')).toBe('https://sales.example.com'); expect(cleanBase('192.168.1.5:3000')).toBe('http://192.168.1.5:3000'); expect(cleanBase('http://localhost:3000/')).toBe('http://localhost:3000');
});

test('many callers share one token refresh', async () => {
  let runs = 0; const go = singleFlight(async () => { runs++; await new Promise(r => setTimeout(r, 20)); return 'ok'; });
  const all = await Promise.all([go(), go(), go()]); expect(all).toEqual(['ok', 'ok', 'ok']); expect(runs).toBe(1);
  await go(); expect(runs).toBe(2); // a later call starts a fresh one
});
