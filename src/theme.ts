// One white, calm look for the whole app. Blue is the only accent; red, amber and green are kept for status.
export const C = {
  bg: '#F4F6FB', card: '#FFFFFF', ink: '#0F1B33', mute: '#5A6781', faint: '#8C97AD', line: '#E3E8F2', sunk: '#EEF2F8',
  accent: '#1F5FD1', accentDark: '#174AA6', accentSoft: '#E7EFFF',
  good: '#0B7A3B', goodSoft: '#E3F5EA', warn: '#8A5A00', warnSoft: '#FFF3D6', crit: '#B42318', critSoft: '#FDE8E6', info: '#1F5FD1', infoSoft: '#E7EFFF',
};
export const R = { sm: 8, md: 12, lg: 16, pill: 999 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const T = {
  h1: { fontSize: 24, fontWeight: '800' as const, color: C.ink, letterSpacing: -0.4 },
  h2: { fontSize: 17, fontWeight: '700' as const, color: C.ink },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  sub: { fontSize: 13, color: C.mute, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700' as const, color: C.faint, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  num: { fontVariant: ['tabular-nums' as const] },
};
export const shadow = { shadowColor: '#0F1B33', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 };
