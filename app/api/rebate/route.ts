import { api, clientIp, need } from '@/lib/auth';
import { rebatePosition, saveRebateSlabs } from '@/lib/growth';

export const GET = api(async () => rebatePosition(await need('rebate.view')));
export const PUT = api(async req => saveRebateSlabs(await need('rebate.manage'), (await req.json().catch(() => ({}))).slabs, await clientIp()));
