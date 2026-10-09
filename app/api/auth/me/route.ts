import { api, need } from '@/lib/auth';

export const GET = api(async () => ({ user: await need() }));
