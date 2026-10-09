import { api, clientIp, need } from '@/lib/auth';
import { saveTargets } from '@/lib/perf';

export const PUT = api(async req => saveTargets(await need('targets.manage'), await req.json().catch(() => ({})), await clientIp()));
