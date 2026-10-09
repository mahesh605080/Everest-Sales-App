import { api, clientIp, need } from '@/lib/auth';
import { saveStock, stockForm, stockView } from '@/lib/req';
import { channelHealth, transfers } from '@/lib/channel';

export const GET = api(async req => {
  const c = new URL(req.url).searchParams.get('customer');
  if (c) return stockForm(await need('stock.report'), Number(c));
  const view = new URL(req.url).searchParams.get('view');
  if (view === 'health') return channelHealth(await need('stock.view'));
  if (view === 'transfers') return transfers(await need('stock.view'));
  return { rows: await stockView(await need('stock.view')) };
});
export const POST = api(async req => saveStock(await need('stock.report'), await req.json().catch(() => ({})), await clientIp()));
