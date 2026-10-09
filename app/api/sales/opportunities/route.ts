import { api, need } from '@/lib/auth';
import { opportunities } from '@/lib/opps';

export const GET = api(async () => opportunities(await need(['orders.create', 'sales.view'])));
