import { api, clientIp, need } from '@/lib/auth';
import { actOrder, getOrder } from '@/lib/sales';

export const GET = api(async (_r, { params }) => getOrder(await need(), Number((await params).id)));
export const POST = api(async (req, { params }) => actOrder(await need(), Number((await params).id), await req.json().catch(() => ({})), await clientIp()));
