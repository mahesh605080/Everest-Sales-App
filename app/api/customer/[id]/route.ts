import { api, need } from '@/lib/auth';
import { customer360 } from '@/lib/customer360';

export const GET = api(async (_r, { params }) => customer360(await need('customers.view'), Number((await params).id)));
