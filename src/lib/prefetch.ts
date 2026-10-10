import { fetchCached } from './data';

let last = 0;
/**
 * Keeps what an order needs on the phone: the product list, and each customer's rates, schemes and credit.
 * Runs quietly after the customer list loads, at most every 15 minutes, so an order can be written where there is no signal.
 */
export async function prepareOffline(customerIds: number[]) {
  if (Date.now() - last < 15 * 60000) return; last = Date.now();
  try {
    await fetchCached('/api/m/products?size=500');
    for (const id of customerIds.slice(0, 80)) { await fetchCached(`/api/pricing?customer=${id}`); await fetchCached(`/api/credit?customer=${id}`); }
  } catch { last = 0; /* no connection now: try again next time */ }
}
