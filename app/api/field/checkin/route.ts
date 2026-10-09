import { api, clientIp, need } from '@/lib/auth';
import { checkIn } from '@/lib/field';

export const POST = api(async req => ({ attendance: await checkIn(await need('field.use'), await req.json().catch(() => ({})), await clientIp()) }));
