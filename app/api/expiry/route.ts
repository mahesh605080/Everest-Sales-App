import { api, need } from '@/lib/auth';
import { batchOffer, customerFor, demandPlan, expiryPosition, matchBuyers } from '@/lib/inventory';
import { expiryLoss, returnAllowance } from '@/lib/returns';
import { shortage } from '@/lib/growth';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams, id = Number(u.get('batch'));
  if (id && u.get('match')) return matchBuyers(await need('inventory.view'), id);
  if (id) { await need(['inventory.view', 'orders.create']); return { batch: await batchOffer(id) }; }
  if (u.get('plan')) { await need(['inventory.manage', 'scorecard.view']); return demandPlan(); }
  if (u.get('shortage')) { await need(['credit.manage', 'dispatch.manage', 'inventory.manage']); return shortage(); }
  if (u.get('loss')) return expiryLoss(await need(['scorecard.view', 'claims.settle']));
  if (u.get('allowance')) { const s = await need(['claims.create', 'claims.approve', 'claims.settle']); return returnAllowance((await customerFor(s, Number(u.get('allowance')))).id); }
  await need('inventory.view');
  return expiryPosition();
});
