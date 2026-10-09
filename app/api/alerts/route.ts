import { api, need } from '@/lib/auth';
import { listAlerts } from '@/lib/field';

export const GET = api(async req => ({ alerts: await listAlerts(await need('alerts.view'), new URL(req.url).searchParams.get('open') !== '0') }));
