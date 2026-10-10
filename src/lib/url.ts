/** Tidy what the person typed as the server address: add https (http for a local address), drop the trailing slash. */
export function cleanBase(raw: string) {
  let v = raw.trim().replace(/\/+$/, ''); if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = (/^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(v) ? 'http://' : 'https://') + v;
  return v;
}
