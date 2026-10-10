export const rs = (n: any) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const short = (n: number) => (n >= 1e7 ? 'Rs ' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? 'Rs ' + (n / 1e5).toFixed(1) + ' L' : rs(n));
export const km = (m: number | null | undefined) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const when = (iso?: string | null) => {
  if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
};
export const ago = (ms: number) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
/** A reference that is unique to this phone and moment; the server uses it to store a re-sent order only once. */
export const newRef = () => 'app-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
