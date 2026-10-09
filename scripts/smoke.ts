/**
 * End-to-end check of the main flows over the real HTTP API.
 * Needs a running app on a database freshly loaded with `npm run seed -- --sample`:
 *   BASE_URL=http://localhost:3000 npm run smoke
 * It creates real records (attendance, a booklet, an order ...), so point it at a test database, never at live data.
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
  if ((await admin.login()) !== 200) console.log('note  ADMIN password was changed; admin-only checks are skipped');
  ok('no session is refused', (await new User('x').get('/api/m/customers')).status === 401);

  // territory
  const mine = (await so.get('/api/m/customers?size=500')).data, all = (await gm.get('/api/m/customers?size=500')).data;
  ok('sales officer sees only assigned customers', mine.total > 0 && mine.total < all.total, [mine.total, all.total]);
  ok('sales officer cannot edit masters', (await so.post('/api/m/customers', { code: 'X', name: 'x', type: 'Distributor' })).status === 403);
  const c1 = mine.rows.find((c: any) => c.code === 'D-1001'), other = all.rows.find((c: any) => c.code === 'D-1002');
  const prods = (await so.get('/api/m/products?size=500')).data.rows, ns = prods.find((p: any) => p.code === 'NS500');
  ok('sample data is present', c1 && other && ns);

  // field day
  const here = { lat: c1.lat + 0.0001, lng: c1.lng + 0.0001, accuracy: 10 };
  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/9oACAEBAAA/APv8/9k=';
  ok('visit before check-in is refused', (await so.post('/api/field/visit/start', { customer_id: c1.id, ...here })).status === 409);
  ok('check-in without selfie is refused', (await so.post('/api/field/checkin', { projection: 100000, ...here })).status === 422);
  ok('check-in', (await so.post('/api/field/checkin', { projection: 100000, photo: img, ...here })).status === 200);
  ok('second check-in is refused', (await so.post('/api/field/checkin', { projection: 1, photo: img, ...here })).status === 409);
  ok("another officer's customer is refused", (await so.post('/api/field/visit/start', { customer_id: other.id, ...here })).status === 403);
  const v = await so.post('/api/field/visit/start', { customer_id: c1.id, ...here });
  ok('visit inside geo-fence is not flagged', v.status === 200 && v.data.visit.out_of_fence === false, v.data);
  ok('visit needs remarks to close', (await so.post('/api/field/visit/end', { purpose: 'Order', remarks: 'ok' })).status === 422);
  ok('visit closes', (await so.post('/api/field/visit/end', { purpose: 'Order', remarks: 'Took the monthly order' })).status === 200);
  const far = await so.post('/api/field/visit/start', { customer_id: c1.id, lat: c1.lat + 0.05, lng: c1.lng, accuracy: 10 });
  ok('visit outside geo-fence is flagged', far.data.visit?.out_of_fence === true, far.data);
  await so.post('/api/field/visit/end', { purpose: 'Courtesy', remarks: 'Second visit of the day' });
  const team = (await asm.get('/api/team/today')).data.people;
  ok('manager sees the officer on duty with a flagged visit', team.some((p: any) => p.code === 'SO01' && p.in_at && p.flagged === 1), team.map((p: any) => p.code));
  ok('geo-fence alert reaches the manager', (await asm.get('/api/alerts')).data.alerts.some((a: any) => a.rule === 'geofence'));

  // credit data
  if (admin.cookie || true) {
    const fd = new FormData(); fd.append('as_of', new Date().toISOString().slice(0, 10));
    fd.append('file', new Blob([`Customer code,Total outstanding,0-30,31-60,61-90,Above 90\nD-1001,820000,520000,210000,90000,0\nD-1002,940000,300000,280000,210000,150000\nD-9999,1,1,0,0,0\n`], { type: 'text/csv' }), 'outstanding.csv');
    const up = await (await fetch(`${BASE}/api/credit/outstanding`, { method: 'POST', headers: { cookie: cc.cookie }, body: fd })).json();
    ok('outstanding upload updates known customers and lists the unknown one', up.updated === 2 && up.failed === 1, up);
  }
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
  ok('GM gives the final approval', (await gm.post(`/api/booklets/${big.id}`, { action: 'approve' })).data.status === 'Accepted');

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

  // money and requests
  const col = (await so.post('/api/req/collections', { customer_id: c1.id, mode: 'Cash', amount: 50000 })).data;
  ok('manager cannot verify a collection', (await asm.post(`/api/req/collections/${col.id}`, { action: 'next' })).status === 403);
  ok('Credit Control verifies the collection', (await cc.post(`/api/req/collections/${col.id}`, { action: 'next' })).data.status === 'Verified');
  const today = (await so.get('/api/perf')).data.info.today;
  const ex = (await so.post('/api/req/expenses', { day: today, route: 'Test route', km_claimed: 400, da: 500 })).data;
  ok('expense far above GPS distance is flagged', ex.over_gps === true, ex);
  ok('one expense claim per day', (await so.post('/api/req/expenses', { day: today, route: 'Again', km_claimed: 5 })).status === 409);
  ok('manager approves, accounts pays', (await asm.post(`/api/req/expenses/${ex.id}`, { action: 'next' })).data.status === 'Approved' && (await cc.post(`/api/req/expenses/${ex.id}`, { action: 'next' })).data.status === 'Paid');
  const lv = (await so2.post('/api/req/leave', { from_date: today, to_date: today, type: 'Casual', remarks: 'Family function' })).data;
  ok('a manager of another area cannot approve leave', (await asm.post(`/api/req/leave/${lv.id}`, { action: 'next' })).status === 403);
  ok('samples log needs the product for a sample', (await so.post('/api/req/samples', { customer_id: c1.id, kind: 'Sample', qty: 5, given_to: 'Dr. Test' })).status === 422);
  ok('sample is recorded and visible to the manager', (await so.post('/api/req/samples', { customer_id: c1.id, kind: 'Sample', product_id: ns.id, qty: 5, given_to: 'Dr. Test' })).status === 200 && (await asm.get('/api/req/samples?box=all')).data.rows.length > 0);
  ok('stock report saves', (await so.post('/api/stock', { customer_id: c1.id, items: [{ product_id: ns.id, stock: 40, sold_30d: 300, near_expiry: 5 }] })).status === 200);

  // performance
  ok('only GM or Admin sets targets', (await asm.put('/api/targets', { month: today.slice(0, 7), items: [] })).status === 403);
  const meRow = (await so.get('/api/perf')).data.rows;
  ok('a sales officer sees only their own scorecard row', meRow.length === 1 && meRow[0].code === 'SO01' && meRow[0].sales >= o1.value, meRow);
  const ov = await gm.get('/api/perf?view=overview');
  ok('control room summary loads', ov.status === 200 && ov.data.sales >= o1.value && ov.data.daily.length > 0);
  const rep = await gm.get(`/api/reports/orders?from=${today.slice(0, 8)}01&to=${today}`);
  ok('report downloads as Excel', rep.status === 200 && (rep.data as ArrayBuffer).byteLength > 3000);
  ok('credit report is hidden from sales managers', (await gm.get('/api/reports/credit')).status === 404);
  ok('end of day', (await so.post('/api/field/checkout', { actual: 95000, ...here })).status === 200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
