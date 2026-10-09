import { api, need } from '@/lib/auth';
import { visitEnd } from '@/lib/field';

export const POST = api(async req => ({ visit: await visitEnd(await need('field.use'), await req.json().catch(() => ({}))) }));
