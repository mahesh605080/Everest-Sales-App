/** The same price rules the server applies, so the order screen can show rate, free boxes and value without a connection. The server's figures are final. */
export type Product = { id: number; code: string; name: string; pack_size?: string | null; units_per_box: number; trade_rate: number };
export type Rate = { rate: number; source: 'type' | 'customer' | 'trade' };
export type Scheme = { id: number; code: string; product_id: number; min_qty: number; bonus_buy: number; bonus_free: number; discount_pct: number; text: string; valid_to?: string };
export type Pricing = { rates: Record<string, Rate>; schemes: Scheme[] };
export type Lot = { id: number; batch_no: string; expiry_date: string; free_boxes: number; offer: { rate: number; text: string } };

export const listRate = (p: Product, pr: Pricing) => pr.rates[String(p.id)]?.rate ?? p.trade_rate;

export function priceLine(p: Product, qty: number, pr: Pricing, lot?: Lot | null) {
  if (lot) return { rate: lot.offer.rate, free: 0, scheme: null as Scheme | null, nudge: null as string | null, value: qty * p.units_per_box * lot.offer.rate, source: 'lot' as const };
  const own = pr.rates[String(p.id)], base = listRate(p, pr), mine = own?.source === 'customer' ? [] : pr.schemes.filter(s => s.product_id === p.id);
  type Best = { s: Scheme; free: number; worth: number };
  let found: Best | null = null;
  for (const s of mine) {
    if (qty < s.min_qty) continue;
    const free = s.bonus_free > 0 ? Math.floor(qty / s.bonus_buy) * s.bonus_free : 0, worth = free * p.units_per_box * base + qty * p.units_per_box * base * s.discount_pct / 100;
    if ((free || s.discount_pct) && (!found || worth > (found as Best).worth)) found = { s, free, worth };
  }
  const best = found as Best | null;
  let nudge: string | null = null;
  if (!best && mine.length && qty > 0) { const s = [...mine].sort((a, b) => a.min_qty - b.min_qty)[0], more = Math.max(s.min_qty, s.bonus_free > 0 ? s.bonus_buy : 0) - qty; if (more > 0) nudge = `${more} more ${more === 1 ? 'box' : 'boxes'} for ${s.text}`; }
  else if (best && best.s.bonus_free > 0) { const more = best.s.bonus_buy - (qty % best.s.bonus_buy); if (more <= Math.ceil(best.s.bonus_buy * 0.3)) nudge = `${more} more ${more === 1 ? 'box' : 'boxes'} for ${best.s.bonus_free} more free`; }
  const rate = Math.round(base * (1 - (best?.s.discount_pct || 0) / 100) * 10000) / 10000;
  return { rate, free: best?.free ?? 0, scheme: best?.s ?? null, nudge, value: qty * p.units_per_box * rate, source: (own?.source ?? 'trade') as 'type' | 'customer' | 'trade' };
}
