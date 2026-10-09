import { api, clientIp, need } from '@/lib/auth';
import { createOrder, listOrders } from '@/lib/sales';

export const GET = api(async req => ({ orders: await listOrders(await need(['orders.create', 'sales.view', 'credit.manage', 'dispatch.manage']), new URL(req.url).searchParams.get('box') || 'mine') }));
export const POST = api(async req => createOrder(await need('orders.create'), await req.json().catch(() => ({})), await clientIp()));
