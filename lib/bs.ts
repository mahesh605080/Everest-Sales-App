import NepaliDate from 'nepali-date-converter';

/** Bikram Sambat parts for an AD date given as 'YYYY-MM-DD'. */
export function toBs(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const n = new NepaliDate(new Date(y, m - 1, d, 12));
  return { year: n.getYear(), month: n.getMonth() + 1, day: n.getDate(), text: n.format('DD MMMM YYYY') };
}
/** Fiscal year label such as 8384 for 2083/84. The fiscal year starts on 1 Shrawan (BS month 4). */
export function fyLabel(iso: string) {
  const b = toBs(iso), start = b.month >= 4 ? b.year : b.year - 1;
  return String(start % 100).padStart(2, '0') + String((start + 1) % 100).padStart(2, '0');
}
/** First day (AD, 'YYYY-MM-DD') of the fiscal year that contains the given AD date: 1 Shrawan. */
export function fyStart(iso: string) {
  const b = toBs(iso), y = b.month >= 4 ? b.year : b.year - 1, d = new NepaliDate(y, 3, 1).toJsDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
