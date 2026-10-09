import { api, need } from '@/lib/auth';
import { lastOrder } from '@/lib/opps';

export const GET = api(async req => lastOrder(await need('orders.create'), Number(new URL(req.url).searchParams.get('customer'))));
