import { api, HttpError, need } from '@/lib/auth';
import { ackAlert } from '@/lib/field';

export const POST = api(async req => {
  const s = await need('alerts.view'); const { id } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id)) throw new HttpError(422, 'Nothing to acknowledge.');
  return ackAlert(s, id);
});
