import { api, clientIp, need } from '@/lib/auth';
import { decidePlan } from '@/lib/plan';

export const POST = api(async req => decidePlan(await need('plan.approve'), await req.json().catch(() => ({})), await clientIp()));
