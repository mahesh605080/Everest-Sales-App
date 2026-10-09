import { api, need } from '@/lib/auth';
import { customerFor } from '@/lib/inventory';
import { pricingFor, schemeResults } from '@/lib/pricing';

export const GET = api(async req => {
  const u = new URL(req.url).searchParams;
  if (u.get('results')) { await need('scorecard.view'); return { schemes: await schemeResults() }; }
  const s = await need(['orders.create', 'schemes.view']);
  return pricingFor(await customerFor(s, Number(u.get('customer'))));
});
