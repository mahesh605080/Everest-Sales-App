import { api, need } from '@/lib/auth';
import { pulse } from '@/lib/pulse';

export const GET = api(async () => pulse(await need()));
