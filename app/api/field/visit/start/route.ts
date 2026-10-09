import { api, clientIp, need } from '@/lib/auth';
import { visitStart } from '@/lib/field';

export const POST = api(async req => ({ visit: await visitStart(await need('field.use'), await req.json().catch(() => ({})), await clientIp()) }));
