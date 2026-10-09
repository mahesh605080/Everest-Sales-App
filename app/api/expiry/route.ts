import { api, need } from '@/lib/auth';
import { batchOffer, expiryPosition, matchBuyers } from '@/lib/inventory';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams, id = Number(u.get('batch'));
  if (id && u.get('match')) return matchBuyers(await need('inventory.view'), id);
  if (id) { await need(['inventory.view', 'orders.create']); return { batch: await batchOffer(id) }; }
  await need('inventory.view');
  return expiryPosition();
});
