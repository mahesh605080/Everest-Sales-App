import { q, q1 } from './db';
import { HttpError } from './auth';
import { audit } from './audit';
import { teamScope } from './field';
import { Session } from './perm';
import { managerOf, notify } from './notify';

const okMonth = (m: any) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const counts = `(select count(*)::int from tour_plan_items i where i.plan_id=p.id) as planned,
  (select count(*)::int from tour_plan_items i where i.plan_id=p.id and exists(select 1 from visits v where v.user_id=p.user_id and v.customer_id=i.customer_id and v.day=i.day)) as done,
  (select count(*)::int from visits v where v.user_id=p.user_id and to_char(v.day,'YYYY-MM')=p.month and not exists(select 1 from tour_plan_items i where i.plan_id=p.id and i.customer_id=v.customer_id and i.day=v.day)) as off_plan`;

export async function myPlan(s: Session, month: string) {
  if (!okMonth(month)) throw new HttpError(422, 'Choose a month.');
  const plan = await q1<any>(`select p.*, ${counts}, d.name as decided_by_name from tour_plans p left join users d on d.id=p.decided_by where p.user_id=$1 and p.month=$2`, [s.id, month]);
  const items = plan ? await q<any>('select i.day, i.customer_id, i.note, c.name as customer from tour_plan_items i join customers c on c.id=i.customer_id where i.plan_id=$1 order by i.day, c.name', [plan.id]) : [];
  const customers = await q<any>(`select c.id, c.name, c.town from customers c join customer_assignments ca on ca.customer_id=c.id and ca.to_date is null where ca.user_id=$1 and c.active order by c.name`, [s.id]);
  return { plan, items, customers };
}

export async function savePlan(s: Session, b: any, submit: boolean, ip: string | null) {
  if (!okMonth(b.month)) throw new HttpError(422, 'Choose a month.');
  const items: any[] = Array.isArray(b.items) ? b.items : [];
  if (items.length > 1500) throw new HttpError(422, 'Too many planned visits.');
  const mine = new Set((await q<any>('select customer_id from customer_assignments where user_id=$1 and to_date is null', [s.id])).map(x => x.customer_id));
  const seen = new Set<string>();
  for (const i of items) {
    if (typeof i.day !== 'string' || !i.day.startsWith(b.month + '-') || isNaN(Date.parse(i.day))) throw new HttpError(422, 'A planned day is outside the chosen month.');
    if (!mine.has(Number(i.customer_id))) throw new HttpError(422, 'A planned customer is not assigned to you.');
    const k = i.day + ':' + i.customer_id; if (seen.has(k)) throw new HttpError(422, 'The same customer is planned twice on one day.'); seen.add(k);
  }
  if (submit && !items.length) throw new HttpError(422, 'Add at least one planned visit before submitting.');
  let plan = await q1<any>('select * from tour_plans where user_id=$1 and month=$2', [s.id, b.month]);
  if (plan && !['Draft', 'Sent back'].includes(plan.status)) throw new HttpError(409, `This plan is ${plan.status.toLowerCase()} and can no longer be changed.`);
  if (!plan) plan = await q1<any>('insert into tour_plans(user_id,month) values($1,$2) returning *', [s.id, b.month]);
  await q('delete from tour_plan_items where plan_id=$1', [plan.id]);
  for (const i of items) await q('insert into tour_plan_items(plan_id,day,customer_id,note) values($1,$2,$3,$4)', [plan.id, i.day, Number(i.customer_id), String(i.note || '').slice(0, 200) || null]);
  await q(`update tour_plans set status=$1, submitted_at=$2, updated_at=now() where id=$3`, [submit ? 'Submitted' : plan.status === 'Sent back' ? 'Sent back' : 'Draft', submit ? new Date() : plan.submitted_at, plan.id]);
  if (submit) await audit(s, 'submit', 'tour_plans', plan.id, null, { month: b.month, visits: items.length }, ip);
  if (submit) await notify([await managerOf(s.id)], `Tour plan for ${b.month} from ${s.name}`, `${items.length} planned visits`, '/plan');
  return { ok: true };
}

export async function teamPlans(s: Session, month: string) {
  if (!okMonth(month)) throw new HttpError(422, 'Choose a month.');
  const params: any[] = [month]; const scope = teamScope(s, params);
  return q<any>(`select p.id,p.status,p.remarks,p.submitted_at,p.decided_at,u.name as person,u.code as person_code,a.name as area,${counts}
                   from tour_plans p join users u on u.id=p.user_id left join areas a on a.id=u.area_id
                  where p.month=$1 and p.status <> 'Draft' and u.id <> ${s.id}${scope} order by (p.status='Submitted') desc, u.name`, params);
}

export async function planItems(s: Session, id: number) {
  const params: any[] = [id]; const scope = teamScope(s, params);
  if (!(await q1(`select 1 from tour_plans p join users u on u.id=p.user_id where p.id=$1${scope}`, params))) throw new HttpError(404, 'Plan not found in your team.');
  return q<any>(`select i.day, c.name as customer, c.town, i.note, exists(select 1 from visits v join tour_plans p on p.id=i.plan_id where v.user_id=p.user_id and v.customer_id=i.customer_id and v.day=i.day) as done
                   from tour_plan_items i join customers c on c.id=i.customer_id where i.plan_id=$1 order by i.day, c.name`, [id]);
}

export async function decidePlan(s: Session, b: any, ip: string | null) {
  const params: any[] = [Number(b.id)]; const scope = teamScope(s, params);
  const plan = await q1<any>(`select p.* from tour_plans p join users u on u.id=p.user_id where p.id=$1 and u.id <> ${s.id}${scope}`, params);
  if (!plan) throw new HttpError(404, 'Plan not found in your team.');
  if (plan.status !== 'Submitted') throw new HttpError(409, 'This plan is not waiting for approval.');
  const approve = b.action === 'approve', remarks = String(b.remarks || '').trim();
  if (!approve && b.action !== 'back') throw new HttpError(422, 'Choose approve or send back.');
  if (!approve && !remarks) throw new HttpError(422, 'Write what should be corrected before sending the plan back.');
  await q('update tour_plans set status=$1, remarks=$2, decided_by=$3, decided_at=now(), updated_at=now() where id=$4', [approve ? 'Approved' : 'Sent back', remarks || null, s.id, plan.id]);
  await notify([plan.user_id], `Tour plan ${plan.month}: ${approve ? 'approved' : 'sent back'}`, `${s.name}${remarks ? ' · ' + remarks : ''}`, '/plan');
  await audit(s, approve ? 'approve' : 'send-back', 'tour_plans', plan.id, { status: plan.status }, { status: approve ? 'Approved' : 'Sent back', remarks }, ip);
  return { ok: true };
}
