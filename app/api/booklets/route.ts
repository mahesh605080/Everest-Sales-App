import { api, clientIp, need } from '@/lib/auth';
import { createBooklet, listBooklets } from '@/lib/sales';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  return { booklets: await listBooklets(await need(['booklets.create', 'booklets.approve', 'sales.view', 'credit.manage', 'orders.create']), u.get('box') || 'mine', Number(u.get('customer')) || undefined) };
});
export const POST = api(async req => createBooklet(await need('booklets.create'), await req.json().catch(() => ({})), await clientIp()));
