import { api, need } from '@/lib/auth';
import { approvalInbox } from '@/lib/growth';

export const GET = api(async () => approvalInbox(await need()));
