import { api, clientIp, need } from '@/lib/auth';
import { actBooklet, getBooklet } from '@/lib/sales';

export const GET = api(async (_r, { params }) => getBooklet(await need(), Number((await params).id)));
export const POST = api(async (req, { params }) => actBooklet(await need(), Number((await params).id), await req.json().catch(() => ({})), await clientIp()));
