import { api, clientIp, need } from '@/lib/auth';
import { savePlan } from '@/lib/plan';

export const POST = api(async req => savePlan(await need('plan.use'), await req.json().catch(() => ({})), true, await clientIp()));
