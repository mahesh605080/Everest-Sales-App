import { api, clientIp, need } from '@/lib/auth';
import { checkOut } from '@/lib/field';

export const POST = api(async req => ({ attendance: await checkOut(await need('field.use'), await req.json().catch(() => ({})), await clientIp()) }));
