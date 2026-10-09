import { api, clientIp, need } from '@/lib/auth';
import { myPlan, planItems, savePlan } from '@/lib/plan';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  if (u.get('id')) return { items: await planItems(await need('plan.approve'), Number(u.get('id'))) };
  return myPlan(await need('plan.use'), u.get('month') || '');
});
export const PUT = api(async req => savePlan(await need('plan.use'), await req.json().catch(() => ({})), false, await clientIp()));
