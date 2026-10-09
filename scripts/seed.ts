/**
 * npm run seed              -> roles, settings and the first admin (safe to run again)
 * npm run seed -- --sample  -> also loads example territories, people, products and customers
 */
import bcrypt from 'bcryptjs';
import { pool, q, q1 } from '../lib/db';
import { ALL_PERMS } from '../lib/perm';

const views = ALL_PERMS.filter(p => p.endsWith('.view'));
const mgr = ['expenses.approve', 'leave.approve', 'tenders.edit', 'reports.run', 'scorecard.view', 'samples.view', 'competitor.view'];
const ROLES: [string, string, number, string[]][] = [
  ['admin', 'Admin', 5, ALL_PERMS],
  ['gm', 'General Manager', 4, [...views, 'export.run', 'plan.approve', 'notices.manage', 'booklets.approve', ...mgr, 'claims.approve', 'targets.manage']],
  ['cc', 'Credit Control', 4, ['customers.view', 'customers.edit', 'terms.view', 'products.view', 'employees.view', 'areas.view', 'regions.view', 'map.view', 'export.run', 'sales.view', 'credit.manage', 'dispatch.manage', 'alerts.view', 'collections.verify', 'expenses.pay', 'claims.settle', 'stock.view', 'tenders.view', 'reports.run']],
  ['rsm', 'Regional Sales Manager', 3, ['employees.view', 'customers.view', 'products.view', 'terms.view', 'areas.view', 'regions.view', 'map.view', 'track.view', 'track.send', 'export.run', 'field.use', 'team.view', 'alerts.view', 'plan.approve', 'booklets.approve', 'sales.view', ...mgr, 'claims.approve', 'expenses.create', 'leave.apply', 'stock.view', 'tenders.view']],
  ['asm', 'Area Sales Manager', 2, ['employees.view', 'customers.view', 'products.view', 'terms.view', 'areas.view', 'map.view', 'track.view', 'track.send', 'export.run', 'field.use', 'team.view', 'alerts.view', 'plan.use', 'plan.approve', 'booklets.create', 'booklets.approve', 'orders.create', 'sales.view', ...mgr, 'collections.create', 'claims.create', 'stock.report', 'expenses.create', 'leave.apply', 'stock.view', 'tenders.view', 'samples.create', 'competitor.create']],
  ['so', 'Sales Officer', 1, ['customers.view', 'products.view', 'terms.view', 'map.view', 'track.send', 'field.use', 'plan.use', 'booklets.create', 'orders.create', 'collections.create', 'claims.create', 'stock.report', 'expenses.create', 'leave.apply', 'tenders.view', 'samples.create', 'competitor.create']],
];
const SETTINGS: [string, string, string, string][] = [
  ['geo_fence_radius_m', '200', 'Geo-fence radius for a valid customer visit', 'metres'],
  ['checkin_late_after_min', '570', 'Check-in counts as late after (minutes from midnight; 570 = 09:30)', 'minutes'],
  ['booklet_asm_band_pct', '2', 'ASM can approve a rate up to this much below base rate', '%'],
  ['booklet_rsm_band_pct', '5', 'RSM can approve a rate up to this much below base rate', '%'],
  ['approval_escalation_hours', '48', 'Escalate a waiting approval to the next level after', 'hours'],
  ['location_retention_days', '180', 'Keep location points for', 'days'],
  ['outstanding_stale_days', '10', 'Warn when the outstanding upload is older than', 'days'],
  ['selfie_required', '1', 'Selfie needed at check-in (1 = yes, 0 = no)', ''],
  ['ta_rate_per_km', '10', 'Travel allowance per km', 'Rs'],
  ['da_daily_limit', '800', 'Daily allowance limit', 'Rs'],
  ['km_tolerance_pct', '15', 'Claimed km may exceed GPS km by', '%'],
  ['incentive_pct_at_90', '0.2', 'Incentive when month sales reach 90% of target (percent of target)', '%'],
  ['incentive_pct_at_100', '0.4', 'Incentive when month sales reach 100% of target (percent of target)', '%'],
  ['visits_per_day_norm', '4', 'Visits expected per working day when there is no tour plan', 'visits'],
  ['dda_expiry_warning_days', '60', 'Warn before a customer\'s DDA licence expires', 'days'],
];

async function main() {
  const sample = process.argv.includes('--sample');
  const pw = process.env.DEFAULT_USER_PASSWORD || 'Everest@123';
  const hash = await bcrypt.hash(pw, 10);

  for (const [key, name, level, perms] of ROLES)
    await q('insert into roles(key,name,level,permissions) values($1,$2,$3,$4) on conflict(key) do nothing', [key, name, level, JSON.stringify(perms)]);
  for (const [key, value, label, unit] of SETTINGS)
    await q('insert into settings(key,value,label,unit) values($1,$2,$3,$4) on conflict(key) do nothing', [key, value, label, unit]);
  const role = async (k: string) => (await q1<any>('select id from roles where key=$1', [k]))!.id;
  await q(`insert into users(code,name,password_hash,role_id) values('ADMIN','Administrator',$1,$2) on conflict(code) do nothing`, [hash, await role('admin')]);
  console.log(`base data ready. Log in as ADMIN with password "${pw}" and change it.`);

  if (sample) {
    const REG = [['E', 'East'], ['C', 'Central'], ['W', 'West'], ['FW', 'Far West']];
    for (const [c, n] of REG) await q('insert into regions(code,name) values($1,$2) on conflict(code) do nothing', [c, n]);
    const reg = async (c: string) => (await q1<any>('select id from regions where code=$1', [c]))!.id;
    const AREAS = [['BRT', 'Biratnagar', 'E', 'Biratnagar'], ['DHR', 'Dharan', 'E', 'Dharan'], ['BRG', 'Birgunj', 'C', 'Birgunj'], ['KTM', 'Kathmandu', 'C', 'Kathmandu'], ['JNK', 'Janakpur', 'C', 'Janakpur'],
      ['BHP', 'Bharatpur', 'C', 'Bharatpur'], ['PKR', 'Pokhara', 'W', 'Pokhara'], ['BTL', 'Butwal', 'W', 'Butwal'], ['NPJ', 'Nepalgunj', 'FW', 'Nepalgunj'], ['DHG', 'Dhangadhi', 'FW', 'Dhangadhi']];
    for (const [c, n, r, t] of AREAS) await q('insert into areas(code,name,region_id,hq_town) values($1,$2,$3,$4) on conflict(code) do nothing', [c, n, await reg(r), t]);
    const area = async (c: string) => (await q1<any>('select id, region_id from areas where code=$1', [c]))!;
    const uid = async (c: string) => (await q1<any>('select id from users where code=$1', [c]))?.id ?? null;
    const addUser = async (code: string, name: string, phone: string, roleKey: string, mgr: string | null, regionCode: string | null, areaCode: string | null) => {
      const a = areaCode ? await area(areaCode) : null;
      await q(`insert into users(code,name,phone,password_hash,role_id,manager_id,region_id,area_id,join_date,must_change_password)
               values($1,$2,$3,$4,$5,$6,$7,$8,'2024-07-16',false) on conflict(code) do nothing`,
        [code, name, phone, hash, await role(roleKey), mgr ? await uid(mgr) : null, a ? a.region_id : regionCode ? await reg(regionCode) : null, a ? a.id : null]);
    };
    await addUser('GM01', 'Anil Joshi', '9800000001', 'gm', null, null, null);
    await addUser('CC01', 'Pooja Agrawal', '9800000002', 'cc', null, null, null);
    await addUser('RSM01', 'Bikash Shrestha', '9800000011', 'rsm', 'GM01', 'C', null);
    await addUser('RSM02', 'Sunita Karki', '9800000012', 'rsm', 'GM01', 'E', null);
    await addUser('RSM03', 'Hari Pandey', '9800000013', 'rsm', 'GM01', 'W', null);
    await addUser('RSM04', 'Laxmi Bohara', '9800000014', 'rsm', 'GM01', 'FW', null);
    await addUser('ASM01', 'Roshan Dahal', '9800000021', 'asm', 'RSM01', null, 'BRG');
    await addUser('ASM02', 'Mina Subedi', '9800000022', 'asm', 'RSM02', null, 'BRT');
    const SOS: [string, string, string, string][] = [['SO01', 'Ramesh Thapa', 'BRG', 'ASM01'], ['SO02', 'Sita Gurung', 'BRT', 'ASM02'], ['SO03', 'Dipesh Yadav', 'JNK', 'RSM01'], ['SO04', 'Manisha Rai', 'BTL', 'RSM03'],
      ['SO05', 'Kiran Adhikari', 'KTM', 'RSM01'], ['SO06', 'Bijay Chaudhary', 'NPJ', 'RSM04'], ['SO07', 'Nabin Karki', 'DHR', 'RSM02'], ['SO08', 'Sarita Poudel', 'PKR', 'RSM03'],
      ['SO09', 'Suman Tamang', 'BHP', 'RSM01'], ['SO10', 'Prakash Bhatta', 'DHG', 'RSM04']];
    for (let i = 0; i < SOS.length; i++) await addUser(SOS[i][0], SOS[i][1], '98000001' + String(i + 1).padStart(2, '0'), 'so', SOS[i][3], null, SOS[i][2]);

    const CATS = [['LVP', 'Large Volume Parenterals'], ['SVP', 'Small Volume Parenterals'], ['EED', 'Eye/Ear Drops'], ['NS', 'Nasal Spray']];
    for (const [c, n] of CATS) await q('insert into product_categories(code,name) values($1,$2) on conflict(code) do nothing', [c, n]);
    const cat = async (c: string) => (await q1<any>('select id from product_categories where code=$1', [c]))!.id;
    const PRODS: [string, string, string, string, string, string, number, number, number][] = [
      ['NS500', 'Sample NS', 'Sodium Chloride', 'LVP', '0.9% w/v', '500 ml bottle', 24, 95, 62], ['D5500', 'Sample D5', 'Dextrose', 'LVP', '5% w/v', '500 ml bottle', 24, 98, 64],
      ['RL500', 'Sample RL', 'Ringer Lactate', 'LVP', '', '500 ml bottle', 24, 100, 66], ['MTZ100', 'Sample Metro IV', 'Metronidazole', 'LVP', '500 mg/100 ml', '100 ml bottle', 50, 60, 38],
      ['PCM100', 'Sample Para IV', 'Paracetamol', 'LVP', '1 g/100 ml', '100 ml bottle', 50, 130, 85], ['WFI10', 'Sample WFI', 'Water for Injection', 'SVP', '', '10 ml ampoule', 100, 15, 9],
      ['CIPED', 'Sample Cipro Drops', 'Ciprofloxacin', 'EED', '0.3% w/v', '5 ml vial', 100, 65, 42], ['XYLNS', 'Sample Xylo Spray', 'Xylometazoline', 'NS', '0.1% w/v', '10 ml bottle', 100, 90, 58]];
    for (const p of PRODS) await q(`insert into products(code,name,generic_name,category_id,strength,pack_size,units_per_box,mrp,trade_rate) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(code) do nothing`,
      [p[0], p[1], p[2], await cat(p[3]), p[4], p[5], p[6], p[7], p[8]]);
    const TERMS: [string, string, number][] = [['CASH', 'Cash', 0], ['CR30', 'Credit 30 days', 30], ['CR45', 'Credit 45 days', 45], ['PDC60', 'PDC 60 days', 60]];
    for (const t of TERMS) await q('insert into payment_terms(code,name,credit_days) values($1,$2,$3) on conflict(code) do nothing', t);
    const term = async (c: string) => (await q1<any>('select id from payment_terms where code=$1', [c]))!.id;
    const CUST: [string, string, string, string, number, number, string, string, string, number, string][] = [
      ['D-1001', 'Sample Bara Pharma Distributors', 'Distributor', 'Birgunj', 27.0104, 84.8777, 'BRG', 'SO01', 'CR30', 1500000, '2027-03-15'],
      ['D-1002', 'Sample Koshi Surgical Suppliers', 'Distributor', 'Biratnagar', 26.4525, 87.2718, 'BRT', 'SO02', 'PDC60', 1000000, '2027-06-30'],
      ['H-2001', 'Sample Chitwan Community Hospital', 'Hospital', 'Bharatpur', 27.6833, 84.4333, 'BHP', 'SO09', 'CR45', 600000, '2027-01-10'],
      ['D-1003', 'Sample Lumbini Medico Traders', 'Distributor', 'Butwal', 27.7006, 83.4483, 'BTL', 'SO04', 'CASH', 800000, '2026-08-30'],
      ['I-3001', 'Sample Provincial Health Logistics Office', 'Institution', 'Hetauda', 27.4287, 85.0322, 'BRG', 'SO01', 'CR45', 2000000, '2027-04-01'],
      ['D-1004', 'Sample Bheri Medical Suppliers', 'Distributor', 'Nepalgunj', 28.05, 81.6167, 'NPJ', 'SO06', 'CR30', 900000, '2026-11-20'],
      ['D-1005', 'Sample Sunsari Medical Hall', 'Distributor', 'Dharan', 26.8125, 87.2833, 'DHR', 'SO07', 'PDC60', 500000, '2027-02-28'],
      ['D-1006', 'Sample Gandaki Pharma House', 'Distributor', 'Pokhara', 28.2096, 83.9856, 'PKR', 'SO08', 'CR30', 1200000, '2027-05-12'],
      ['H-2002', 'Sample Valley Care Hospital', 'Hospital', 'Kathmandu', 27.7172, 85.324, 'KTM', 'SO05', 'CR45', 700000, '2027-08-01'],
      ['D-1007', 'Sample Mithila Drug House', 'Distributor', 'Janakpur', 26.7288, 85.9263, 'JNK', 'SO03', 'CR30', 600000, '2027-01-31'],
      ['D-1008', 'Sample Seti Pharma Traders', 'Distributor', 'Dhangadhi', 28.6852, 80.6216, 'DHG', 'SO10', 'CR30', 400000, '2026-12-05'],
      ['D-1009', 'Sample Narayani Medical Stores', 'Retailer', 'Birgunj', 27.0167, 84.8667, 'BRG', '', 'CASH', 0, '2027-09-09']];
    for (const c of CUST) {
      const a = await area(c[6]);
      const row = await q1<any>(`insert into customers(code,name,type,town,lat,lng,area_id,payment_term_id,credit_limit,dda_expiry) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(code) do nothing returning id`,
        [c[0], c[1], c[2], c[3], c[4], c[5], a.id, await term(c[8]), c[9], c[10]]);
      if (row && c[7]) await q('insert into customer_assignments(customer_id,user_id) values($1,$2)', [row.id, await uid(c[7])]);
    }
    console.log(`sample data loaded. Every sample user (GM01, CC01, RSM01, ASM01, SO01 ...) uses password "${pw}".`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
