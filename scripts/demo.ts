/**
 * Demo data on top of the sample masters, so every screen has something realistic to show:
 *   npm run migrate && npm run seed -- --sample && npm run demo
 * Six months of orders, batch-wise company stock, distributor stock reports, outstanding, visits, claims, rebate slabs and targets.
 * Everything it adds is marked DEMO. Use it on a test database only; it does nothing if it has already run.
 */
import { pool, q, q1 } from '../lib/db';

let seed = 20830101;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

async function main() {
  if (await q1(`select 1 from sales_orders where no like 'SO-DEMO-%' limit 1`)) { console.log('demo data is already loaded.'); return; }
  const custs = await q<any>(`select c.id, c.code, c.type, c.lat, c.lng, c.credit_limit, ca.user_id from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null where c.active and c.code like '%-%' order by c.id`);
  const prods = await q<any>(`select p.id, p.code, p.units_per_box, p.trade_rate, k.code as cat from products p join product_categories k on k.id=p.category_id where p.active order by p.id`);
  if (custs.length < 5 || prods.length < 5) { console.log('load the sample masters first: npm run seed -- --sample'); return; }
  const admin = (await q1<any>(`select id from users where code='ADMIN'`))!.id;
  const day = (n: number) => `(now() at time zone 'Asia/Kathmandu')::date - ${Math.round(n)}`;

  // 1. six months of orders. Each customer has its own size and its own usual basket; one of them stopped ordering 50 days ago.
  let no = 0; const monthly = new Map<string, number>();
  for (const [ci, c] of custs.entries()) {
    const size = [2.6, 1.8, 0.9, 1.3, 2.2, 0.7, 1.1, 1.6, 0.8, 1.2, 0.6][ci % 11], basket = prods.filter((_, pi) => (pi + ci) % 3 !== 0), stopped = ci === 3;
    for (let m = 5; m >= 0; m--) for (let k = 0; k < int(1, 3); k++) {
      const ago = m * 30 + int(1, 28); if (stopped && ago < 50) continue; if (ago < 2) continue;
      const lines = basket.filter(() => rnd() < 0.6).slice(0, 4); if (!lines.length) continue;
      const items = lines.map(p => { const qty = Math.max(2, Math.round((p.cat === 'LVP' ? int(30, 90) : int(8, 30)) * size * (1 + (5 - m) * 0.04))); return { p, qty, v: Math.round(qty * p.units_per_box * p.trade_rate * 100) / 100 }; });
      const value = items.reduce((a, i) => a + i.v, 0), done = ago > 6;
      const o = (await q<any>(`insert into sales_orders(no,user_id,customer_id,order_date,value,status,decided_by,decided_at,dispatched_by,dispatched_at,invoice_no,remarks,created_at)
         values($1,$2,$3,${day(ago)},$4,$5,$6,now() - ($7::int * interval '1 day'),$8,${done ? `now() - ($7::int * interval '1 day') + interval '1 day'` : 'null'},$9,'DEMO',now() - ($7::int * interval '1 day')) returning id`,
        [`SO-DEMO-${String(++no).padStart(4, '0')}`, c.user_id, c.id, value, done ? 'Dispatched' : 'Approved', admin, ago, done ? admin : null, done ? `INV-D${no}` : null]))[0];
      for (const i of items) { await q('insert into sales_order_items(order_id,product_id,qty,units_per_box,rate,value,list_rate,price_source) values($1,$2,$3,$4,$5,$6,$5,$7)', [o.id, i.p.id, i.qty, i.p.units_per_box, i.p.trade_rate, i.v, 'trade']);
        if (ago <= 90) monthly.set(`${c.id}:${i.p.id}`, (monthly.get(`${c.id}:${i.p.id}`) || 0) + i.qty / 3); }
    }
  }

  // 2. company stock by batch: an expired lot, short-dated lots, healthy lots, and one product almost out.
  const up = (await q<any>(`insert into stock_uploads(as_of,file_name,mode,rows_ok,rows_failed,uploaded_by) values(${day(1)},'DEMO stock.xlsx','full',$1,0,$2) returning id`, [prods.length * 2 + 1, admin]))[0].id;
  const batch = (pid: number, b: string, inDays: number, qty: number) => q(`insert into stock_batches(product_id,batch_no,expiry_date,qty_boxes,location,as_of,upload_id) values($1,$2,${day(-inDays)},$3,'Main',${day(1)},$4) on conflict do nothing`, [pid, b, qty, up]);
  for (const [i, p] of prods.entries()) {
    await batch(p.id, `${p.code.slice(0, 3)}${2401 + i}`, [75, 110, 150, 45, 200, 95, 170, 130][i % 8], [420, 300, 260, 180, 350, 240, 150, 200][i % 8]);
    await batch(p.id, `${p.code.slice(0, 3)}${2520 + i}`, 420 + i * 30, i === 2 ? 25 : [2600, 1900, 0, 900, 1400, 700, 500, 650][i % 8] || 800);
  }
  await batch(prods[0].id, `${prods[0].code.slice(0, 3)}2290`, -25, 36);

  // 3. distributor stock reports: some running low, some healthy, some sitting on far too much.
  for (const [ci, c] of custs.filter(c => c.type === 'Distributor').entries()) {
    const mine = prods.filter(p => monthly.has(`${c.id}:${p.id}`)); if (!mine.length) continue;
    const rep = (await q<any>(`insert into stock_reports(user_id,customer_id,day) values($1,$2,${day(int(2, 9))}) on conflict(customer_id,day) do nothing returning id`, [c.user_id, c.id]))[0]; if (!rep) continue;
    for (const [pi, p] of mine.entries()) { const sold = Math.max(1, Math.round(monthly.get(`${c.id}:${p.id}`)! * (0.8 + rnd() * 0.3))), f = [0.15, 1.1, 4.5, 0.9, 0.3, 1.6][(ci + pi) % 6], stock = Math.round(sold * f);
      await q('insert into stock_report_items(report_id,product_id,stock,sold_30d,near_expiry) values($1,$2,$3,$4,$5)', [rep.id, p.id, stock, sold, f > 4 ? Math.round(stock * 0.2) : 0]); }
  }

  // 4. outstanding and aging; two customers carry old dues.
  for (const [ci, c] of custs.entries()) {
    const lim = Number(c.credit_limit) || 300000, total = Math.round(lim * [0.35, 0.55, 0.2, 0.7, 0.45, 0.3][ci % 6]), old = ci % 5 === 1 ? Math.round(total * 0.25) : 0, b1 = Math.round(total * 0.25);
    await q(`insert into outstanding_balances(customer_id,total,b0,b1,b2,b3,as_of) values($1,$2,$3,$4,$5,$6,${day(2)})
             on conflict(customer_id) do update set total=excluded.total, b0=excluded.b0, b1=excluded.b1, b2=excluded.b2, b3=excluded.b3, as_of=excluded.as_of`, [c.id, total, total - b1 - old, b1, Math.round(old * 0.6), old - Math.round(old * 0.6)]);
  }

  // 5. visits of the last 40 days; two customers have been left alone.
  for (const [ci, c] of custs.entries()) { if (ci % 6 === 4) continue;
    for (let k = 0; k < int(1, 4); k++) { const ago = int(1, 38);
      await q(`insert into visits(user_id,customer_id,day,in_at,in_lat,in_lng,in_accuracy,distance_m,out_of_fence,out_at,out_lat,out_lng,purpose,person_met,remarks)
               values($1,$2,${day(ago)},now() - ($3::int * interval '1 day') - interval '3 hours',$4,$5,12,$6,$7,now() - ($3::int * interval '1 day') - interval '150 minutes',$4,$5,$8,'Store in-charge','DEMO visit: stock checked and order discussed')`,
        [c.user_id, c.id, ago, c.lat, c.lng, int(8, 60), false, pick(['Order', 'Collection', 'Courtesy', 'Stock check'])]); } }

  // 6. collections, expiry claims, rebate slabs, this month's targets.
  for (const c of custs.slice(0, 8)) await q(`insert into collections(user_id,customer_id,day,mode,amount,ref_no,status,remarks) values($1,$2,${day(int(3, 25))},$3,$4,$5,'Verified','DEMO')`, [c.user_id, c.id, pick(['Cash', 'Bank transfer']), int(4, 30) * 5000, `DEMO-${c.code}`]);
  for (const [k, c] of custs.filter(c => c.type === 'Distributor').slice(0, 5).entries()) { const p = prods[(k * 2) % prods.length], qty = int(2, 8);
    await q(`insert into claims(user_id,customer_id,day,type,product_id,qty,batch_no,expiry_date,amount,remarks,status) values($1,$2,${day(20 + k * 35)},$3,$4,$5,$6,${day(40 + k * 35)},$7,'DEMO return',$8)`,
      [c.user_id, c.id, k % 2 ? 'Near expiry' : 'Expired stock', p.id, qty, `${p.code.slice(0, 3)}23${10 + k}`, Math.round(qty * p.units_per_box * p.trade_rate * 0.9), ['Settled', 'Approved', 'Settled', 'Submitted', 'Approved'][k]]); }
  if (!(await q1('select 1 from rebate_slabs where active limit 1'))) for (const [f, pct] of [[500000, 1], [1500000, 1.5], [3000000, 2.5]]) await q('insert into rebate_slabs(from_value,pct) values($1,$2)', [f, pct]);
  for (const u of await q<any>(`select distinct user_id from customer_assignments where to_date is null`))
    await q(`insert into targets(user_id,month,amount,updated_by) values($1,to_char(now() at time zone 'Asia/Kathmandu','YYYY-MM'),$2,$3) on conflict do nothing`, [u.user_id, int(4, 9) * 100000, admin]);

  console.log(`demo data loaded: ${no} orders over six months, ${prods.length * 2 + 1} stock batches, stock reports, outstanding, visits, claims, rebate slabs and targets.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
