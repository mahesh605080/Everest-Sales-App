import { api, clientIp, need } from '@/lib/auth';
import { createReq, listReq, reqDef } from '@/lib/req';

export const GET = api(async (req, { params }) => {
  const def = reqDef((await params).key);
  return { rows: await listReq(def, await need([def.create, ...def.steps.map(s => s.perm)]), new URL(req.url).searchParams.get('box') || 'mine') };
});
export const POST = api(async (req, { params }) => { const def = reqDef((await params).key); return createReq(def, await need(def.create), await req.json().catch(() => ({})), await clientIp()); });
