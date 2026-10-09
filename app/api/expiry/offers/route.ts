import { api, clientIp, need } from '@/lib/auth';
import { offerSlabs, saveSlabs } from '@/lib/inventory';

export const GET = api(async () => { await need('inventory.view'); return { slabs: await offerSlabs() }; });
export const PUT = api(async req => saveSlabs(await need('inventory.manage'), (await req.json().catch(() => ({}))).slabs, await clientIp()));
