import { api, clientIp, need } from '@/lib/auth';
import { actReq, reqDef } from '@/lib/req';

export const POST = api(async (req, { params }) => { const p = await params; return actReq(reqDef(p.key), await need(), Number(p.id), await req.json().catch(() => ({})), await clientIp()); });
