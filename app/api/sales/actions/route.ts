import { api, need } from '@/lib/auth';
import { actionFeedback, actions, feedbackSummary, segments } from '@/lib/opps';

export const GET = api(async req => {
  const v = new URL(req.url).searchParams.get('view');
  if (v === 'feedback') return feedbackSummary(await need('sales.view'));
  if (v === 'classes') return segments(await need(['orders.create', 'sales.view']));
  return actions(await need(['orders.create', 'sales.view']));
});
export const POST = api(async req => actionFeedback(await need('orders.create'), await req.json().catch(() => ({}))));
