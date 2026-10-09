import { api, need } from '@/lib/auth';
import { suggestOrder } from '@/lib/channel';

export const GET = api(async req => suggestOrder(await need('orders.create'), Number(new URL(req.url).searchParams.get('customer'))));
