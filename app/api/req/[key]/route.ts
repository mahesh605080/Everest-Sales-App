import { api, clientIp, need } from '@/lib/auth';
import { createReq, listReq, reqDef } from '@/lib/req';
import { readFilter } from '@/lib/filters';

export const GET = api(async (req, { params }) => {
  const def = reqDef((await params).key);
  return { rows: await listReq(def, await need([def.create, ...def.steps.map(s => s.perm), ...(def.view ? [def.view] : [])]), new URL(req.url).searchParams.get('box') || 'mine', readFilter(req.url)) };
});
export const POST = api(async (req, { params }) => { const def = reqDef((await params).key); return createReq(def, await need(def.create), await req.json().catch(() => ({})), await clientIp()); });
