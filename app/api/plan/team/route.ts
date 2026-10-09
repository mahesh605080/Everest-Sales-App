import { api, need } from '@/lib/auth';
import { teamPlans } from '@/lib/plan';

export const GET = api(async req => ({ plans: await teamPlans(await need('plan.approve'), new URL(req.url).searchParams.get('month') || '') }));
