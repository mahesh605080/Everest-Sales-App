/**
 * End-to-end check of the main flows over the real HTTP API.
 * Needs a running app on a database freshly loaded with `npm run seed -- --sample`:
 *   BASE_URL=http://localhost:3000 npm run smoke
 * It creates real records (visits, a booklet, an order ...), so point it at a test database, never at live data.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.DEFAULT_USER_PASSWORD || 'Everest@123';
let pass = 0, fail = 0;
const ok = (name: string, cond: any, extra?: any) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + JSON.stringify(extra)}`); };

class User {
  cookie = '';
  constructor(public code: string) {}
  async login(pw = PW) {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: this.code, password: pw }) });
    this.cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    return r.status;
  }
  async call(method: string, path: string, body?: any): Promise<{ status: number; data: any }> {
    const r = await fetch(BASE + path, { method, headers: { cookie: this.cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b?: any) => this.call('POST', p, b ?? {});
  put = (p: string, b: any) => this.call('PUT', p, b);
}

async function main() {
  const so = new User('SO01'), so2 = new User('SO02'), asm = new User('ASM01'), rsm = new User('RSM01'), gm = new User('GM01'), cc = new User('CC01'), admin = new User('ADMIN');
  ok('wrong password is refused', (await new User('SO01').login('wrong-password')) === 401);
  for (const u of [so, so2, asm, rsm, gm, cc]) ok(`login ${u.code}`, (await u.login()) === 200);
  if ((await admin.login()) === 200) ok('a temporary password blocks everything except changing it', (await admin.get('/api/m/regions')).status === 403);
  else console.log('note  ADMIN password was changed; that check is skipped');
  ok('no session is refused', (await new User('x').get('/api/m/customers')).status === 401);

  // territory
  const mine = (await so.get('/api/m/customers?size=500')).data, all = (await gm.get('/api/m/customers?size=500')).data;
  ok('sales officer sees only assigned customers', mine.total > 0 && mine.total < all.total, [mine.total, all.total]);
  ok('sales officer cannot edit masters', (await so.post('/api/m/customers', { code: 'X', name: 'x', type: 'Distributor' })).status === 403);
  const c1 = mine.rows.find((c: any) => c.code === 'D-1001'), other = all.rows.find((c: any) => c.code === 'D-1002');
  const prods = (await so.get('/api/m/products?size=500')).data.rows, ns = prods.find((p: any) => p.code === 'NS500');
  ok('sample data is present', c1 && other && ns);

  // customer visits (no day check-in is needed)
  const here = { lat: c1.lat + 0.0001, lng: c1.lng + 0.0001, accuracy: 10 };
  ok('visit without a location is refused', (await so.post('/api/field/visit/start', { customer_id: c1.id })).status === 422);
  ok("another officer's customer is refused", (await so.post('/api/field/visit/start', { customer_id: other.id, ...here })).status === 403);
  const v = await so.post('/api/field/visit/start', { customer_id: c1.id, ...here });
  ok('visit inside geo-fence is not flagged', v.status === 200 && v.data.visit.out_of_fence === false, v.data);
  ok('visit needs remarks to close', (await so.post('/api/field/visit/end', { purpose: 'Order', remarks: 'ok' })).status === 422);
  ok('visit closes', (await so.post('/api/field/visit/end', { purpose: 'Order', remarks: 'Took the monthly order' })).status === 200);
  const far = await so.post('/api/field/visit/start', { customer_id: c1.id, lat: c1.lat + 0.05, lng: c1.lng, accuracy: 10 });
  ok('visit outside geo-fence is flagged', far.data.visit?.out_of_fence === true, far.data);
  await so.post('/api/field/visit/end', { purpose: 'Courtesy', remarks: 'Second visit of the day' });
  const team = (await asm.get('/api/team/today')).data.people;
  ok('manager sees the officer\'s visits with one flagged', team.some((p: any) => p.code === 'SO01' && p.visits === 2 && p.flagged === 1), team.map((p: any) => p.code));
  ok('geo-fence alert reaches the manager', (await asm.get('/api/alerts')).data.alerts.some((a: any) => a.rule === 'geofence'));

  // credit data
  if (admin.cookie || true) {
    const fd = new FormData(); fd.append('as_of', new Date().toISOString().slice(0, 10)); fd.append('mode', 'partial');
    fd.append('file', new Blob([`Customer code,Total outstanding,0-30,31-60,61-90,Above 90\nD-1001,820000,520000,210000,90000,0\nD-1002,940000,300000,280000,210000,150000\nD-9999,1,1,0,0,0\n`], { type: 'text/csv' }), 'outstanding.csv');
    const up = await (await fetch(`${BASE}/api/credit/outstanding`, { method: 'POST', headers: { cookie: cc.cookie }, body: fd })).json();
    ok('outstanding upload updates known customers and lists the unknown one', up.updated === 2 && up.failed === 1, up);
  }
  ok('dropdown lists obey the territory rule', (await so.get('/api/m/customers/options')).data.options.length === mine.total && (await so.get('/api/m/employees/options')).data.options.length === 1);
  const cr = (await so.get(`/api/credit?customer=${c1.id}`)).data.credit;
  ok('credit position shows uploaded outstanding', cr.outstanding === 820000 && cr.available === cr.credit_limit - 820000 + cr.collected - cr.committed, cr);

  // booklet chain
  const due = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
  ok('rate below base needs a reason', (await so.post('/api/booklets', { customer_id: c1.id, due_date: due, items: [{ product_id: ns.id, qty: 100, ask_rate: ns.trade_rate - 1 }] })).status === 422);
  const small = (await so.post('/api/booklets', { customer_id: c1.id, due_date: due, items: [{ product_id: ns.id, qty: 100, ask_rate: ns.trade_rate * 0.99, remarks: 'Competitor rate' }] })).data;
  ok('1% below base ends at ASM', small.final_level === 'asm', small);
  const mtz = prods.find((p: any) => p.code === 'MTZ100');
  const big = (await so.post('/api/booklets', { customer_id: c1.id, due_date: due, items: [{ product_id: mtz.id, qty: 50, ask_rate: mtz.trade_rate, bonus_buy: 10, bonus_free: 1, remarks: 'Bulk scheme' }] })).data;
  ok('10+1 bonus (9% below base) goes to GM', big.final_level === 'gm', big);
  ok('creator cannot approve own booklet', (await so.post(`/api/booklets/${small.id}`, { action: 'approve' })).status === 403);
  ok('RSM cannot jump the ASM step', (await rsm.post(`/api/booklets/${small.id}`, { action: 'approve' })).status === 403);
  ok('ASM approval accepts the small booklet', (await asm.post(`/api/booklets/${small.id}`, { action: 'approve' })).data.status === 'Accepted');
  await asm.post(`/api/booklets/${big.id}`, { action: 'approve' }); await rsm.post(`/api/booklets/${big.id}`, { action: 'approve' });
  ok('reject needs remarks', (await gm.post(`/api/booklets/${big.id}`, { action: 'reject' })).status === 422);
  ok('the ASM was notified about the new booklet', (await asm.get('/api/notifications')).data.items.some((n: any) => n.title.includes(small.no)));
  ok('GM gives the final approval', (await gm.post(`/api/booklets/${big.id}`, { action: 'approve' })).data.status === 'Accepted');

  ok('the creator is notified of the decision', (await so.get('/api/notifications')).data.items.some((n: any) => n.title.includes(big.no) && n.title.includes('final')));
  // orders
  ok('order cannot exceed the booklet balance', (await so.post('/api/orders', { customer_id: c1.id, booklet_id: small.id, items: [{ product_id: ns.id, qty: 101 }] })).status === 422);
  const o1 = (await so.post('/api/orders', { customer_id: c1.id, booklet_id: small.id, items: [{ product_id: ns.id, qty: 40 }] })).data;
  ok('order at booklet rate', o1.no && Math.abs(o1.value - 40 * ns.units_per_box * ns.trade_rate * 0.99) < 1, o1);
  const d5 = prods.find((p: any) => p.code === 'D5500');
  const o2 = (await so2.post('/api/orders', { customer_id: other.id, items: [{ product_id: d5.id, qty: 100 }] })).data;
  ok('order beyond available credit is marked over limit', o2.over_limit === true, o2);
  ok('sales officer cannot approve an order', (await so.post(`/api/orders/${o1.id}`, { action: 'approve' })).status === 403);
  ok('over-limit approval needs a remark', (await cc.post(`/api/orders/${o2.id}`, { action: 'approve' })).status === 422);
  ok('Credit Control approves the order', (await cc.post(`/api/orders/${o1.id}`, { action: 'approve' })).data.status === 'Approved');
  ok('approved value is held against credit', (await so.get(`/api/credit?customer=${c1.id}`)).data.credit.committed >= o1.value);
  ok('another officer cannot open the order', (await so2.get(`/api/orders/${o1.id}`)).status === 404);
  ok('dispatch', (await cc.post(`/api/orders/${o1.id}`, { action: 'dispatch', invoice_no: 'INV-TEST' })).data.status === 'Dispatched');
  ok('Credit Control can cancel an accepted booklet', (await cc.post(`/api/booklets/${big.id}`, { action: 'cancel', remarks: 'Overdue balance' })).data.status === 'Cancelled');

  // selling shortcuts
  const last = (await so.get(`/api/sales/last-order?customer=${c1.id}`)).data;
  ok('repeat order finds the last order lines', last.order?.no === o1.no && last.items[0].product_id === ns.id && last.items[0].qty === 40, last);
  ok("repeat order respects territory", (await so.get(`/api/sales/last-order?customer=${other.id}`)).status === 403);
  const opp = (await so.get('/api/sales/opportunities')).data;
  ok('opportunities list the approved rate that still has boxes to order', opp.booklets.some((b: any) => b.no === small.no && b.boxes_left === 60), opp.booklets);
  ok('a customer who never ordered is listed as not ordering', opp.lapsed.some((c: any) => c.customer.includes('Provincial')) && !opp.lapsed.some((c: any) => c.customer_id === c1.id), opp.lapsed.map((c: any) => c.customer));
  ok('opportunities are limited to own customers', (await so2.get('/api/sales/opportunities')).data.booklets.length === 0);

  // money and requests
  const col = (await so.post('/api/req/collections', { customer_id: c1.id, mode: 'Cash', amount: 50000 })).data;
  ok('manager cannot verify a collection', (await asm.post(`/api/req/collections/${col.id}`, { action: 'next' })).status === 403);
  ok('Credit Control verifies the collection', (await cc.post(`/api/req/collections/${col.id}`, { action: 'next' })).data.status === 'Verified');
  const today = (await so.get('/api/perf')).data.info.today;
  ok('removed screens are gone', (await so.get('/api/req/expenses')).status === 404 && (await so.get('/api/req/leave')).status === 404 && (await so.post('/api/field/checkin', {})).status === 404);
  ok('samples log needs the product for a sample', (await so.post('/api/req/samples', { customer_id: c1.id, kind: 'Sample', qty: 5, given_to: 'Dr. Test' })).status === 422);
  ok('sample is recorded and visible to the manager', (await so.post('/api/req/samples', { customer_id: c1.id, kind: 'Sample', product_id: ns.id, qty: 5, given_to: 'Dr. Test' })).status === 200 && (await asm.get('/api/req/samples?box=all')).data.rows.length > 0);
  await so.post('/api/stock', { customer_id: c1.id, items: [{ product_id: mtz.id, stock: 20, sold_30d: 200, near_expiry: 0 }, { product_id: ns.id, stock: 40, sold_30d: 300, near_expiry: 5 }] });
  const ro = (await so.get('/api/sales/opportunities')).data.reorder;
  ok('low stock without a recent order is suggested for reorder', ro.some((r: any) => r.product_id === mtz.id && r.cover_days === 3 && r.suggest_boxes === 180) && !ro.some((r: any) => r.product_id === ns.id), ro);
  ok('stock report saves', (await so.post('/api/stock', { customer_id: c1.id, items: [{ product_id: ns.id, stock: 40, sold_30d: 300, near_expiry: 5 }] })).status === 200);

  // performance
  ok('only GM or Admin sets targets', (await asm.put('/api/targets', { month: today.slice(0, 7), items: [] })).status === 403);
  const meRow = (await so.get('/api/perf')).data.rows;
  ok('a sales officer sees only their own scorecard row', meRow.length === 1 && meRow[0].code === 'SO01' && meRow[0].sales >= o1.value, meRow);
  const ov = await gm.get('/api/perf?view=overview');
  ok('control room summary loads', ov.status === 200 && ov.data.sales >= o1.value && ov.data.daily.length > 0);
  ok('sales pipeline counts the dispatched order', ov.data.pipeline.so_dispatched >= 1 && ov.data.pipeline.so_dispatched_value >= o1.value, ov.data.pipeline);
  const rep = await gm.get(`/api/reports/orders?from=${today.slice(0, 8)}01&to=${today}`);
  ok('report downloads as Excel', rep.status === 200 && (rep.data as ArrayBuffer).byteLength > 3000);
  ok('credit report is hidden from sales managers', (await gm.get('/api/reports/credit')).status === 404);

  // two orders racing for the last boxes of a booklet: only one may win
  const race = (await so.post('/api/booklets', { customer_id: c1.id, due_date: due, items: [{ product_id: ns.id, qty: 10, ask_rate: ns.trade_rate * 0.99, remarks: 'Race test' }] })).data;
  await asm.post(`/api/booklets/${race.id}`, { action: 'approve' });
  const both = await Promise.all([1, 2, 3, 4].map(() => so.post('/api/orders', { customer_id: c1.id, booklet_id: race.id, items: [{ product_id: ns.id, qty: 10 }] })));
  ok('simultaneous orders cannot overdraw a booklet', both.filter(r => r.status === 200).length === 1, both.map(r => r.status));
  // a full outstanding file sets customers that are not in it to zero
  { const fd = new FormData(); fd.append('as_of', new Date().toISOString().slice(0, 10)); fd.append('mode', 'full');
    fd.append('file', new Blob([`Customer code,Total outstanding,0-30,31-60,61-90,Above 90\nD-1001,500000,500000,0,0,0\n`], { type: 'text/csv' }), 'full.csv');
    const up = await (await fetch(`${BASE}/api/credit/outstanding`, { method: 'POST', headers: { cookie: cc.cookie }, body: fd })).json();
    ok('a full outstanding file zeroes customers that are not in it', up.updated === 1 && up.zeroed === 1 && (await so2.get(`/api/credit?customer=${other.id}`)).data.credit.outstanding === 0, up); }
  ok('health check answers', (await fetch(`${BASE}/api/health`)).status === 200);

  // company stock by batch, expiry and near-expiry selling
  { const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const send = async (u: User, csv: string, mode: string) => { const fd = new FormData(); fd.append('as_of', day(0)); fd.append('mode', mode); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'stock.csv');
      const r = await fetch(`${BASE}/api/expiry/stock`, { method: 'POST', headers: { cookie: u.cookie }, body: fd }); return { status: r.status, data: await r.json() }; };
    const csv = `Product code,Batch,Expiry,Quantity (boxes),Location\nNS500,NS-A,${day(120)},200,Main\nNS500,NS-B,${day(600)},500,Main\nMTZ100,MT-X,${day(30)},60,Main\nD5500,D5-OLD,${day(-10)},15,Main\nNOPE,B1,${day(300)},5,Main\n`;
    ok('a sales officer cannot upload company stock', (await send(so, csv, 'partial')).status === 403);
    const up = (await send(cc, csv, 'partial')).data;
    ok('stock upload takes good batches and lists the bad row', up.updated === 4 && up.failed === 1, up);
    const pos = (await so.get('/api/expiry')).data, B = (n: string) => pos.rows.find((b: any) => b.batch_no === n);
    ok('a batch 3 to 6 months from expiry carries the 15% offer', B('NS-A')?.offer?.discount_pct === 15 && Math.abs(B('NS-A').offer.rate - ns.trade_rate * 0.85) < 0.01, B('NS-A'));
    ok('stock that normal sale cannot clear in time is shown at risk', B('NS-A').at_risk > 150 && B('NS-A').at_risk < 200 && B('NS-B').at_risk > 0 && B('NS-B').at_risk < 500, [B('NS-A').at_risk, B('NS-B').at_risk, B('NS-A').run_rate]);
    ok('expired and too-short stock gets no offer', B('D5-OLD').expired && !B('D5-OLD').offer && B('MT-X').unsellable && !B('MT-X').offer);
    ok('the expiry ladder adds up', pos.ladder[0].boxes === 15 && pos.ladder.reduce((a: number, l: any) => a + l.boxes, 0) === 775, pos.ladder);
    const m = (await so.get(`/api/expiry?batch=${B('NS-A').id}&match=1`)).data;
    ok('buyer matching finds the customer who can use the batch in time', m.buyers[0]?.id === c1.id && m.buyers[0].can_take === 200, m.buyers);
    ok('buyer matching is limited to own customers', !(await so2.get(`/api/expiry?batch=${B('NS-A').id}&match=1`)).data.buyers.some((b: any) => b.id === c1.id));
    ok('the selling list shows the near-expiry chance', (await so.get('/api/sales/opportunities')).data.expiry.some((e: any) => e.batch_no === 'NS-A' && e.customer_id === c1.id));
    const lot = (qty: number, id = B('NS-A').id, extra: any = {}) => so.post('/api/orders', { customer_id: c1.id, ...extra, items: [{ product_id: ns.id, qty, batch_id: id }] });
    ok('a lot order cannot exceed the batch', (await lot(201)).status === 422);
    ok('a lot cannot be mixed with a booklet', (await lot(10, B('NS-A').id, { booklet_id: small.id })).status === 422);
    ok('expired stock cannot be ordered', (await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: d5.id, qty: 1, batch_id: B('D5-OLD').id }] })).status === 422);
    const lo = (await lot(50)).data, lod = (await so.get(`/api/orders/${lo.id}`)).data;
    ok('lot order is priced at the offer rate and marked non-returnable', Math.abs(lo.value - 50 * ns.units_per_box * ns.trade_rate * 0.85) < 1 && lod.items[0].non_returnable === true && lod.items[0].batch_no === 'NS-A', [lo, lod.items]);
    ok('ordered boxes leave the free stock', (await so.get(`/api/expiry?batch=${B('NS-A').id}`)).data.batch.free_boxes === 150);
    const plain = (await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: ns.id, qty: 160 }] })).data, pd = (await so.get(`/api/orders/${plain.id}`)).data;
    ok('an ordinary order is planned earliest-expiry-first', pd.items[0].fefo?.plan[0].batch_no === 'NS-A' && pd.items[0].fefo.plan[0].qty === 150 && pd.items[0].fefo.plan[1].batch_no === 'NS-B', pd.items[0].fefo);
    await cc.post(`/api/orders/${lo.id}`, { action: 'approve', remarks: 'Near-expiry lot' });
    const claim = (batch: string, x: any = {}) => so.post('/api/req/claims', { customer_id: c1.id, type: 'Near expiry', product_id: ns.id, qty: 5, batch_no: batch, expiry_date: day(60), amount: 5000, remarks: 'Return of short-dated stock', ...x });
    ok('a non-returnable lot cannot come back as an expiry claim', (await claim('ns-a')).status === 422);
    // returns policy
    ok('an expiry claim needs the batch and expiry date', (await claim('NS-OTHER', { expiry_date: '' })).status === 422);
    ok('stock far from expiry cannot be returned yet', (await claim('NS-OTHER', { expiry_date: day(200) })).status === 422);
    ok('stock expired long ago cannot be returned', (await claim('NS-OTHER', { type: 'Expired stock', expiry_date: day(-300) })).status === 422);
    ok('a claim cannot be worth more than the stock', (await claim('NS-OTHER', { qty: 1 })).status === 422);
    const cl = await claim('NS-OTHER'), mineC = (await so.get('/api/req/claims?box=mine')).data.rows.find((r: any) => r.id === cl.data.id);
    ok('a claim inside the window is accepted and carries the policy flags', cl.status === 200 && mineC.flags.some((f: any) => f.k === 'over_cap') && mineC.flags.some((f: any) => f.k === 'batch_not_traced'), mineC?.flags);
    ok('a claim over the yearly limit is not for the ASM', (await asm.post(`/api/req/claims/${cl.data.id}`, { action: 'next' })).status === 403);
    ok('a flagged claim needs a remark to approve', (await gm.post(`/api/req/claims/${cl.data.id}`, { action: 'next' })).status === 422);
    ok('GM approves the flagged claim with a remark', (await gm.post(`/api/req/claims/${cl.data.id}`, { action: 'next', remarks: 'Invoice checked, one-time exception' })).data.status === 'Approved');
    const mm = await claim('NS-B', { qty: 1, amount: 1000 }), mmr = (await so.get('/api/req/claims?box=mine')).data.rows.find((r: any) => r.id === mm.data.id);
    ok('an expiry date that differs from the company record is flagged', mmr?.flags.some((f: any) => f.k === 'expiry_mismatch'), mmr?.flags);
    const al = (await so.get(`/api/expiry?allowance=${c1.id}`)).data;
    ok('the returns allowance of a customer adds up', al.cap_pct === 2 && al.returned === 6000 && Math.abs(al.allowed - al.bought * 0.02) < 0.01 && al.left === 0, al);
    const loss = (await gm.get('/api/expiry?loss=1')).data;
    ok('the loss screen totals returns, godown expiry and near-expiry recovery', loss.returns.total === 6000 && loss.godown.expired_boxes === 15 && loss.lots.boxes === 50 && loss.byCustomer[0].over === true, loss);
    ok('the loss screen is not open to a sales officer', (await so.get('/api/expiry?loss=1')).status === 403);
    ok('offer slabs are validated', (await gm.put('/api/expiry/offers', { slabs: [{ months_from: 0, months_to: 4, discount_pct: 30 }, { months_from: 3, months_to: 6, discount_pct: 15 }] })).status === 422 && (await so.put('/api/expiry/offers', { slabs: [] })).status === 403);
  }

  // schemes and price lists
  { const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const wfi = prods.find((p: any) => p.code === 'WFI10'), cip = prods.find((p: any) => p.code === 'CIPED');
    const sch = { code: 'T-WFI', name: 'Test WFI scheme', product_id: wfi.id, min_qty: 20, bonus_buy: 10, bonus_free: 1, discount_pct: 5, valid_from: day(-1), valid_to: day(30) };
    ok('a sales officer cannot create a scheme', (await so.post('/api/m/schemes', sch)).status === 403);
    ok('a bonus needs both numbers', (await gm.post('/api/m/schemes', { ...sch, bonus_buy: 0 })).status === 422);
    ok('GM creates a scheme', (await gm.post('/api/m/schemes', sch)).status === 200);
    const pr = (await so.get(`/api/pricing?customer=${c1.id}`)).data;
    ok('the order screen is told about the running scheme', pr.schemes.some((x: any) => x.code === 'T-WFI' && x.text === '10+1 and 5% off'), pr.schemes);
    const line = async (p: any, qty: number) => { const o = (await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: p.id, qty }] })).data; return { o, i: (await so.get(`/api/orders/${o.id}`)).data.items[0] }; };
    const a = await line(wfi, 25);
    ok('the scheme applies itself: discount on the rate and free boxes', a.i.free_qty === 2 && Math.abs(a.i.rate - wfi.trade_rate * 0.95) < 0.001 && Math.abs(a.o.value - 25 * wfi.units_per_box * wfi.trade_rate * 0.95) < 1 && a.i.scheme_text.startsWith('T-WFI'), a);
    const b = await line(wfi, 10);
    ok('below the minimum boxes there is no scheme', b.i.free_qty === 0 && b.i.rate === wfi.trade_rate && !b.i.scheme_text, b.i);
    ok('a price rule needs a customer type or one customer, not both or neither', (await gm.post('/api/m/rates', { code: 'T-R0', name: 'x', product_id: cip.id, rate: 40 })).status === 422);
    ok('GM creates a price list rate for distributors', (await gm.post('/api/m/rates', { code: 'T-R1', name: 'Distributor list', product_id: cip.id, customer_type: 'Distributor', rate: 40 })).status === 200);
    const c = await line(cip, 2);
    ok('an order picks up the price-list rate', c.i.rate === 40 && c.i.price_source === 'type' && c.i.list_rate === 40, c.i);
    ok('GM creates a contract rate for one customer', (await gm.post('/api/m/rates', { code: 'T-R2', name: 'Contract', product_id: wfi.id, customer_id: c1.id, rate: 8 })).status === 200);
    const d = await line(wfi, 25);
    ok('a contract rate wins and takes no scheme on top', d.i.rate === 8 && d.i.free_qty === 0 && d.i.price_source === 'customer', d.i);
    const res = (await gm.get('/api/pricing?results=1')).data.schemes.find((x: any) => x.code === 'T-WFI');
    ok('scheme results show what it sold and what it cost', res?.orders === 1 && res.boxes === 25 && res.free_boxes === 2 && Math.abs(res.cost - (25 * wfi.units_per_box * wfi.trade_rate * 0.05 + 2 * wfi.units_per_box * wfi.trade_rate)) < 1, res);
    ok('scheme results are not open to a sales officer', (await so.get('/api/pricing?results=1')).status === 403);
  }

  // suggested order, bought against sold, and moving stock between distributors
  { const sg = (await so.get(`/api/sales/suggest?customer=${c1.id}`)).data;
    ok('suggested order fills up to the target days less stock and orders on the way', sg.basis === 'stock' && sg.items.length === 1 && sg.items[0].product_id === ns.id && sg.items[0].qty === 450 - 40 - sg.stock[ns.id].coming, sg);
    ok('suggested order respects territory', (await so.get(`/api/sales/suggest?customer=${other.id}`)).status === 403);
    await so2.post('/api/stock', { customer_id: other.id, items: [{ product_id: ns.id, stock: 2000, sold_30d: 100, near_expiry: 0 }] });
    ok('an overstocked distributor gets no suggestion', (await so2.get(`/api/sales/suggest?customer=${other.id}`)).data.items.length === 0);
    const h = (await gm.get('/api/stock?view=health')).data.rows, hr = (c: any) => h.find((r: any) => r.customer_id === c.id && r.product_id === ns.id);
    ok('bought-vs-sold marks overstock and low stock', hr(other)?.status === 'Overstocked' && hr(other).excess === 1700 && hr(c1)?.status === 'Running low', [hr(other), hr(c1)]);
    const tr = (await gm.get('/api/stock?view=transfers')).data.rows;
    ok('a transfer is suggested from the overstocked distributor to the one running short', tr.some((t: any) => t.from_id === other.id && t.to_id === c1.id && t.product_id === ns.id && t.boxes === sg.items[0].qty), tr);
    ok('channel views are not open to a sales officer', (await so.get('/api/stock?view=transfers')).status === 403);
  }

  // one ranked action list with answers, and customer classes
  { const al = (await so.get('/api/sales/actions')).data, bkKey = `bk:${c1.id}:${small.id}`;
    ok('the action list ranks chances by value and urgency', al.actions.some((a: any) => a.key === bkKey) && al.actions.every((a: any, i: number) => !i || al.actions[i - 1].score >= a.score), al.actions.map((a: any) => [a.key, a.score]));
    ok('"not interested" needs a reason', (await so.post('/api/sales/actions', { key: bkKey, outcome: 'no' })).status === 422);
    ok('an action for another territory cannot be answered', (await so.post('/api/sales/actions', { key: `lap:${other.id}`, outcome: 'done' })).status === 403);
    ok('a made-up action is refused', (await so.post('/api/sales/actions', { key: 'x:1', outcome: 'done' })).status === 422);
    ok('answering hides the action', (await so.post('/api/sales/actions', { key: bkKey, outcome: 'no', reason: 'Has enough stock' })).status === 200 && !(await so.get('/api/sales/actions')).data.actions.some((a: any) => a.key === bkKey));
    const fb = (await asm.get('/api/sales/actions?view=feedback')).data;
    ok('the manager sees why customers said no', fb.counts.no === 1 && fb.reasons[0].reason === 'Has enough stock' && (await so.get('/api/sales/actions?view=feedback')).status === 403, fb);
    const cl = (await gm.get('/api/sales/actions?view=classes')).data;
    ok('customers are classed A, B, C by 12-month sales', cl.customers.find((c: any) => c.id === c1.id)?.cls === 'A' && cl.summary.reduce((a: number, x: any) => a + x.customers, 0) === cl.customers.length && cl.customers.some((c: any) => c.cls === 'C'), cl.summary);
  }

  // yearly rebate, fair share when stock is short, one approval inbox
  { ok('a sales officer cannot set rebate slabs', (await so.put('/api/rebate', { slabs: [{ from_value: 100000, pct: 1 }] })).status === 403);
    ok('a higher slab must give a higher rebate', (await gm.put('/api/rebate', { slabs: [{ from_value: 100000, pct: 2 }, { from_value: 500000, pct: 1 }] })).status === 422);
    ok('GM sets rebate slabs', (await gm.put('/api/rebate', { slabs: [{ from_value: 100000, pct: 1 }, { from_value: 500000, pct: 2 }] })).status === 200);
    const rb = (await gm.get('/api/rebate')).data, r1 = rb.rows.find((r: any) => r.id === c1.id);
    ok('rebate position shows the slab reached and the gap to the next', r1 && r1.bought > 100000 && r1.pct === 1 && Math.abs(r1.earned - r1.bought * 0.01) < 0.01 && Math.abs(r1.gap - (500000 - r1.bought)) < 0.01 && rb.fy.length === 4, r1);
    ok('a sales officer sees only own distributors in the rebate list', (await so.get('/api/rebate')).data.rows.every((r: any) => r.id !== other.id));
    await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: ns.id, qty: 700 }] });
    const sh = (await cc.get('/api/expiry?shortage=1')).data.rows.find((r: any) => r.product_id === ns.id);
    ok('short stock is shared out and never more than the stock', sh && sh.short === sh.ordered - sh.stock && sh.lines.reduce((a: number, l: any) => a + l.share, 0) === sh.stock && sh.lines.every((l: any) => l.share <= l.qty), sh);
    ok('the shortage view is not open to a sales officer', (await so.get('/api/expiry?shortage=1')).status === 403);
    const ib = (await gm.get('/api/approvals')).data.items, ic = (await cc.get('/api/approvals')).data.items;
    ok('one inbox lists what waits for each person', ib.some((i: any) => i.type === 'Claim' && i.warn) && ic.some((i: any) => i.type === 'Sales order') && (await so.get('/api/approvals')).data.items.length === 0, [ib.map((i: any) => i.type), ic.map((i: any) => i.type)]);
    const one = ic.find((i: any) => i.type === 'Sales order' && !i.warn);
    ok('an item can be decided straight from the inbox', one && (await cc.post(one.url, { ...one.ok, remarks: 'ok' })).data.status === 'Approved' && !(await cc.get('/api/approvals')).data.items.some((i: any) => i.key === one.key), one);
  }

  // the new features where people look first: dashboard pulse, customer page, reports, booklet base rate
  { const pg = (await gm.get('/api/pulse')).data.cards, ps = (await so.get('/api/pulse')).data.cards, K = (c: any[], k: string) => c.find((x: any) => x.k === k);
    ok('the dashboard pulse shows stock at risk, approvals and returns to the GM', K(pg, 'risk')?.value > 0 && K(pg, 'approvals')?.value > 0 && K(pg, 'returns')?.tone === 'crit' && K(pg, 'short'), pg);
    ok('a sales officer gets the selling cards only', K(ps, 'actions') && !K(ps, 'returns') && !K(ps, 'short') && !K(ps, 'approvals'), ps);
    for (const k of ['expiry-position', 'expiry-returns', 'channel', 'transfers', 'scheme-results', 'rebate', 'customer-classes', 'action-answers']) { const r = await gm.get(`/api/reports/${k}`); ok(`report ${k} downloads`, r.status === 200 && (r.data as ArrayBuffer).byteLength > 2000, r.status); }
    const html = new TextDecoder().decode((await so.get(`/customers/${c1.id}`)).data as ArrayBuffer);
    ok('the customer page shows class, returns allowance and running schemes', html.includes('Selling to this customer') && html.includes('Expiry returns allowance') && html.includes('contract'), html.length);
    const cip = prods.find((p: any) => p.code === 'CIPED'), due2 = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const bkl = (await so.post('/api/booklets', { customer_id: c1.id, due_date: due2, items: [{ product_id: cip.id, qty: 10, ask_rate: 40 }] })).data;
    ok("a booklet at the customer's price-list rate is not below base", bkl.final_level === 'asm', bkl);
  }

  // dispatch takes batches out of stock; money and cross-sell actions; stock-out list
  { const pos0 = (await gm.get('/api/expiry')).data, A0 = pos0.rows.find((b: any) => b.batch_no === 'NS-A');
    ok('the expiry position lists products running out', Array.isArray(pos0.running_out) && pos0.stockout_days === 30);
    const od = (await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: ns.id, qty: 20 }] })).data;
    await cc.post(`/api/orders/${od.id}`, { action: 'approve', remarks: 'Covered by PDC' });
    ok('dispatching an order works', (await cc.post(`/api/orders/${od.id}`, { action: 'dispatch', invoice_no: 'INV-B1' })).data.status === 'Dispatched');
    const det = (await so.get(`/api/orders/${od.id}`)).data.items[0], A1 = (await gm.get(`/api/expiry?batch=${A0.id}`)).data.batch;
    ok('dispatch records the batch sent and takes it out of stock', det.sent?.[0]?.batch_no === 'NS-A' && det.sent[0].qty === 20 && A1.qty_boxes === A0.qty_boxes - 20 && A1.free_boxes === A0.free_boxes - 20, [det.sent, A0.qty_boxes, A1.qty_boxes, A0.free_boxes, A1.free_boxes]);
    const mineO = (await so.get('/api/orders?box=mine&status=Approved')).data.orders; let lotO: any = null;
    for (const o of mineO) { const d = (await so.get(`/api/orders/${o.id}`)).data; if (d.items[0].non_returnable) lotO = d; }
    ok('a near-expiry lot is dispatched from its own batch without changing what is free', lotO && (await cc.post(`/api/orders/${lotO.order.id}`, { action: 'dispatch' })).data.status === 'Dispatched' && (await gm.get(`/api/expiry?batch=${A0.id}`)).data.batch.free_boxes === A1.free_boxes && (await gm.get(`/api/expiry?batch=${A0.id}`)).data.batch.qty_boxes === A1.qty_boxes - 50, lotO?.order);
    const acts = (await so.get('/api/sales/actions')).data.actions;
    ok('an order held for credit becomes a "collect payment" action', acts.some((a: any) => a.key === `col:${c1.id}` && a.kind === 'Collect payment'), acts.map((a: any) => a.key));
    ok('the collect action can be answered', (await so.post('/api/sales/actions', { key: `col:${c1.id}`, outcome: 'later' })).status === 200);
  }

  { const dp = (await gm.get('/api/expiry?plan=1')).data, nsr = dp.rows.find((r: any) => r.id === ns.id);
    ok('the demand plan works out cover and what to make', dp.target_days === 60 && nsr && nsr.per_month > 0 && nsr.stock > 0 && nsr.make === Math.max(0, Math.ceil(Math.max(nsr.per_month, nsr.trend_pct > 20 ? nsr.last_30 : 0) * 2 + nsr.open) - (nsr.stock - nsr.at_risk)), nsr);
    ok('the demand plan is not open to a sales officer', (await so.get('/api/expiry?plan=1')).status === 403 && (await gm.get('/api/reports/demand-plan')).status === 200);
  }

  // what the mobile app relies on
  { const tk = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'SO01', password: PW }) })).json();
    const bearer = (m: string, p: string, b?: any) => fetch(BASE + p, { method: m, headers: { authorization: `Bearer ${tk.token}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, data: await r.json() }));
    ok('the app can work with a token instead of a cookie', tk.token && (await bearer('GET', '/api/auth/me')).data.user?.code === 'SO01');
    const body = { customer_id: c1.id, client_ref: 'app-test-0001-abcd', items: [{ product_id: ns.id, qty: 3 }] };
    const a1 = await bearer('POST', '/api/orders', body), a2 = await bearer('POST', '/api/orders', body);
    ok('an order sent twice by the app is booked once', a1.status === 200 && a2.data.id === a1.data.id && a2.data.duplicate === true && a2.data.no === a1.data.no, [a1.data, a2.data]);
    const cb = { customer_id: c1.id, mode: 'Cash', amount: 1234, client_ref: 'app-test-col-0001' };
    const k1 = await bearer('POST', '/api/req/collections', cb), k2 = await bearer('POST', '/api/req/collections', cb);
    ok('a collection sent twice by the app is recorded once', k1.status === 200 && k2.data.id === k1.data.id && k2.data.duplicate === true, [k1.data, k2.data]);
    const pts = await bearer('POST', '/api/track/ping', { points: [{ lat: 27.01, lng: 84.87, accuracy: 9, at: Date.now() - 600000 }, { lat: 27.011, lng: 84.871, accuracy: 12, at: Date.now() - 300000, mocked: true }, { lat: 999, lng: 1 }] });
    ok('background location points arrive in a batch', pts.data.saved === 2, pts.data);
    const open = (await bearer('GET', '/api/field/today')).data.open; if (open) await bearer('POST', '/api/field/visit/end', { purpose: 'Courtesy', remarks: 'closing the open visit' });
    const mv = await bearer('POST', '/api/field/visit/start', { customer_id: c1.id, lat: c1.lat, lng: c1.lng, accuracy: 8, mocked: true, source: 'app' });
    ok('a visit started with a mock location is marked', mv.data.visit?.mock_location === true && mv.data.visit.source === 'app', mv.data);
    await bearer('POST', '/api/field/visit/end', { purpose: 'Courtesy', remarks: 'mock location test visit' });
    ok('the manager gets a mock-location alert', (await asm.get('/api/alerts')).data.alerts.some((a: any) => a.rule === 'mock_location'));
  }

  // the platform service (Python) and the web app share logins: either can end the other's
  { const P = '/api/v1/auth', json = { 'content-type': 'application/json' };
    const plat = (m: string, path: string, tok?: string, body?: any, cookie?: string) => fetch(BASE + path, { method: m, headers: { ...json, ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
    ok('the platform service answers through the web address', (await plat('GET', '/api/v1/health/ready')).data.ok === true);
    const pl = await plat('POST', `${P}/login`, undefined, { login: 'SO05', password: PW, device: { installation_id: 'smoke-phone-0001', platform: 'android', model: 'Smoke Phone' } });
    ok('platform login accepts a password the web app hashed', pl.status === 200 && pl.data.expires_in === 900 && !!pl.data.refresh_token, pl.data);
    const viaWeb = await fetch(`${BASE}/api/m/customers`, { headers: { authorization: `Bearer ${pl.data.access_token}` } });
    ok("the web app's own API accepts the platform's short token", viaWeb.status === 200);
    const a = new User('SO05'), b = new User('SO05'); await a.login(); await b.login();
    const list = await plat('GET', `${P}/sessions`, undefined, undefined, a.cookie);
    ok('logins made on the web are listed by the platform', list.status === 200 && list.data.sessions.filter((x: any) => x.client === 'web').length >= 2 && list.data.sessions.some((x: any) => x.device === 'Smoke Phone'), list.data);
    const mineSid = list.data.sessions.find((x: any) => x.current).id, otherWeb = list.data.sessions.find((x: any) => x.client === 'web' && !x.current).id;
    const del = await fetch(`${BASE}${P}/sessions/${otherWeb}`, { method: 'DELETE', headers: { cookie: a.cookie, origin: BASE } });
    ok('ending one web login from the platform stops only that browser', del.status === 200 && (await b.get('/api/auth/me')).status === 401 && (await a.get('/api/auth/me')).status === 200, [del.status, mineSid]);
    ok('logging out on the web ends the login itself, not just the cookie', (await a.post('/api/auth/logout')).status === 200 && (await a.get('/api/auth/me')).status === 401);
    ok('platform logout stops the token on the web API too', (await plat('POST', `${P}/logout`, pl.data.access_token)).status === 200 && (await fetch(`${BASE}/api/m/customers`, { headers: { authorization: `Bearer ${pl.data.access_token}` } })).status === 401);
    // a password set by the platform (Argon2id written in Python) must log in on the web, and the other way round
    const p6 = await plat('POST', `${P}/login`, undefined, { login: 'SO06', password: PW });
    ok('platform changes a password', (await plat('POST', `${P}/password`, p6.data.access_token, { current: PW, next: 'Crossed-Passw0rd' })).status === 200);
    const w6 = new User('SO06');
    ok('the web app logs in with the password the platform set', (await w6.login('Crossed-Passw0rd')) === 200 && (await new User('SO06').login(PW)) === 401);
    ok('the web app changes it back', (await w6.post('/api/auth/password', { current: 'Crossed-Passw0rd', next: PW })).status === 200 && (await plat('POST', `${P}/login`, undefined, { login: 'SO06', password: PW })).status === 200);
    ok('a refresh token made before the web password change is dead', (await plat('POST', `${P}/refresh`, undefined, { refresh_token: p6.data.refresh_token })).status === 401);
    // nobody but the Super Admin may raise a person or a role to their own level
    const boss = await plat('POST', `${P}/login`, undefined, { login: 'ADMIN', password: PW });
    const bossPw = await plat('POST', `${P}/password`, boss.data.access_token, { current: PW, next: 'Admin-Passw0rd-1' });
    const su = new User('ADMIN'); await su.login('Admin-Passw0rd-1');
    const roles = (await su.get('/api/roles')).data.roles, gmRole = roles.find((r: any) => r.key === 'gm'), adminRole = roles.find((r: any) => r.key === 'admin'), soRole = roles.find((r: any) => r.key === 'so');
    ok('the Super Admin lets the GM manage people and roles', bossPw.status === 200 && (await su.put('/api/roles', { id: gmRole.id, permissions: [...gmRole.permissions, 'employees.edit', 'roles.manage'] })).status === 200);
    const emps = (await su.get('/api/m/employees?size=500')).data.rows, E = (c: string) => emps.find((e: any) => e.code === c);
    ok('a GM cannot raise a person to Super Admin', (await gm.put(`/api/m/employees/${E('SO09').id}`, { role_id: adminRole.id })).status === 403);
    ok('a GM cannot make a person a GM either', (await gm.put(`/api/m/employees/${E('SO09').id}`, { role_id: gmRole.id })).status === 403);
    ok('a GM cannot edit the Super Admin or themselves', (await gm.put(`/api/m/employees/${E('ADMIN').id}`, { name: 'Taken Over' })).status === 403 && (await gm.put(`/api/m/employees/${E('GM01').id}`, { role_id: adminRole.id })).status === 403);
    ok('a GM can still edit a person below them', (await gm.put(`/api/m/employees/${E('SO09').id}`, { email: 'so09@example.test' })).status === 200);
    ok('a GM cannot change their own role or a higher one', (await gm.put('/api/roles', { id: gmRole.id, permissions: gmRole.permissions })).status === 403 && (await gm.put('/api/roles', { id: adminRole.id, permissions: [] })).status === 403);
    ok('a GM cannot hand out a permission they do not hold', (await gm.put('/api/roles', { id: soRole.id, permissions: [...soRole.permissions, 'settings.manage'] })).status === 403 && (await gm.put('/api/roles', { id: soRole.id, permissions: soRole.permissions })).status === 200);
    await su.put('/api/roles', { id: gmRole.id, permissions: gmRole.permissions });
  }

  // live events: what the web app does reaches the platform's event log, and through it every open screen
  { const meId = (await so.get('/api/auth/me')).data.user.id, ev = async (u: User, ch: string, since = 0) => (await u.get(`/api/v1/realtime/events?channel=${ch}&since=${since}`));
    const before = (await ev(so, `user:${meId}`)).data.last_event_id;
    const od = (await so.post('/api/orders', { customer_id: c1.id, items: [{ product_id: ns.id, qty: 2 }] })).data;
    await cc.post(`/api/orders/${od.id}`, { action: 'approve', remarks: 'ok' });
    const mine = (await ev(so, `user:${meId}`, before)).data.events;
    ok('an approval made on the web becomes a live event for the person who placed the order', mine.some((e: any) => e.event === 'notification' && e.payload.title.includes(od.no)), mine);
    ok('nobody else can read that private channel', (await ev(so2, `user:${meId}`)).status === 403 && (await ev(gm, `user:${meId}`)).status === 403);
    const ccId = (await cc.get('/api/auth/me')).data.user.id;
    const room = (await so.post('/api/v1/chat/rooms', { user_ids: [ccId] })).data;
    ok('chat works through the web address', (await so.post(`/api/v1/chat/rooms/${room.id}/messages`, { text: 'Order sent, please check', client_id: 'smoke-chat-1' })).status === 201 && (await cc.get('/api/v1/chat/rooms')).data.rooms.some((r: any) => r.id === room.id && r.unread === 1) && (await so2.get(`/api/v1/chat/rooms/${room.id}/messages`)).status === 404);
    ok('the chat screen opens', (await so.get('/chat')).status === 200);
  }

  // files through the web address, with the browser's cookie
  { const send = async (u: User, name: string, bytes: Uint8Array | string, type = 'application/octet-stream') => { const fd = new FormData(); fd.append('file', new Blob([bytes as any], { type }), name); fd.append('folder', 'Smoke');
      const r = await fetch(`${BASE}/api/v1/files`, { method: 'POST', headers: { cookie: u.cookie, origin: BASE }, body: fd }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
    const pdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n';
    const up = await send(so, 'rate letter.pdf', pdf, 'application/pdf');
    ok('a file can be stored through the web address', up.status === 201 && up.data.content_type === 'application/pdf' && up.data.folder === 'Smoke', up);
    ok('a program dressed up as a photo is refused', (await send(so, 'photo.jpg', new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'image/jpeg')).status === 415);
    const dl = await fetch(`${BASE}/api/v1/files/${up.data.id}/download`, { headers: { cookie: so.cookie } });
    ok('the owner downloads it; another person cannot see it', dl.status === 200 && (await dl.text()) === pdf && (await so2.get(`/api/v1/files/${up.data.id}`)).status === 404);
    const lk = (await so.post(`/api/v1/files/${up.data.id}/link`, { seconds: 120 })).data;
    ok('a time-limited link opens it without login', (await fetch(BASE + lk.path)).status === 200 && (await fetch(BASE + lk.path.slice(0, -3) + 'AAA')).status === 404);
    ok('the files screen opens', (await so.get('/files')).status === 200);
  }

  // notifications through the web address, with the browser's cookie
  { const cfg = (await so.get('/api/v1/push/config')).data;
    ok('the browser gets the push settings, never a private key', typeof cfg.webpush?.enabled === 'boolean' && !JSON.stringify(cfg).includes('private') && Array.isArray(cfg.categories), cfg);
    const pr = await so.put('/api/v1/notifications/preferences', { push_enabled: true, muted_categories: ['stock'], quiet_from: '21:00', quiet_to: '07:00' });
    ok('a person sets what they want to be told about', pr.status === 200 && pr.data.muted_categories[0] === 'stock' && pr.data.quiet_from === '21:00', pr);
    const me = (await so.get('/api/auth/me')).data.user.id;
    ok('a field officer cannot send notifications', (await so.post('/api/v1/notifications', { title: 'x', audience: { kind: 'users', ids: [me] } })).status === 403);
    const title = `Smoke notice ${Date.now()}`;
    const sent = await gm.post('/api/v1/notifications', { title, body: 'Depot closed tomorrow', url: '/orders', category: 'general', audience: { kind: 'users', ids: [me] } });
    ok('a manager sends one; the result says exactly what happened', sent.status === 200 && sent.data.deliveries['inapp:stored'] === 1 && !('webpush:accepted' in sent.data.deliveries), sent);
    const bell = (await so.get('/api/notifications')).data;
    ok('it is under the bell of the person it was sent to', bell.items.some((n: any) => n.title === title && n.link === '/orders' && !n.read), bell.items?.[0]);
    const muted = await gm.post('/api/v1/notifications', { title: title + ' stock', category: 'stock', audience: { kind: 'users', ids: [me] } });
    ok('a muted kind is held back and reported as such', muted.data.deliveries?.['inapp:skipped'] === 1 && !(await so.get('/api/notifications')).data.items.some((n: any) => n.title === title + ' stock'), muted);
    await so.put('/api/v1/notifications/preferences', { push_enabled: true, muted_categories: [] });
    ok('the send screen and the settings open', (await gm.get('/notify')).status === 200 && (await so.get('/profile')).status === 200 && (await gm.get('/api/v1/notifications')).data.notifications.some((n: any) => n.title === title));
    const sw = await (await fetch(`${BASE}/sw.js`)).text();
    ok('the service worker handles push and taps', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'") && sw.includes('/api/v1/notifications/ack'));
  }

  // changing a password signs out every other session of that person
  const second = new User('SO02'); await second.login();
  const ch = await fetch(`${BASE}/api/auth/password`, { method: 'POST', headers: { cookie: so2.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ current: PW, next: PW + '-new1' }) });
  ok('password change works', ch.status === 200);
  ok('other sessions are signed out after a password change', (await second.get('/api/auth/me')).status === 401);
  so2.cookie = (ch.headers.get('set-cookie') || '').split(';')[0];
  ok('the session that changed the password stays signed in', (await so2.get('/api/auth/me')).status === 200);
  await so2.post('/api/auth/password', { current: PW + '-new1', next: PW }); // put it back so the test can run again on the same day's database

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
