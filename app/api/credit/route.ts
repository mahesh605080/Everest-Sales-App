import { api, clientIp, need } from '@/lib/auth';
import { creditFor, creditList, saveInstrument, setLimit } from '@/lib/sales';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  if (u.get('customer')) return { credit: await creditFor(await need(), Number(u.get('customer'))) };
  await need('credit.manage');
  return { customers: await creditList(u.get('q') || '') };
});
export const PUT = api(async req => setLimit(await need('credit.manage'), await req.json().catch(() => ({})), await clientIp()));
export const POST = api(async req => saveInstrument(await need('credit.manage'), await req.json().catch(() => ({})), await clientIp()));
