import { api, clientIp, need } from '@/lib/auth';
import { saveStock, stockForm, stockView } from '@/lib/req';

export const GET = api(async req => {
  const c = new URL(req.url).searchParams.get('customer');
  if (c) return stockForm(await need('stock.report'), Number(c));
  return { rows: await stockView(await need('stock.view')) };
});
export const POST = api(async req => saveStock(await need('stock.report'), await req.json().catch(() => ({})), await clientIp()));
