import { api, need } from '@/lib/auth';
import { latestPings } from '@/lib/track';

export const GET = api(async () => ({ people: await latestPings(await need('track.view')) }));
