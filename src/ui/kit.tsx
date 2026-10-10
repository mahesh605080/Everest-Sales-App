import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, S, shadow, T } from '@/theme';
import { ago } from '@/lib/format';

export const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };
export const done = () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); };

export function Screen({ children, onRefresh, refreshing, footer, pad = true }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; footer?: ReactNode; pad?: boolean }) {
  const inset = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: pad ? S.lg : 0, paddingBottom: S.xl + (footer ? 84 : 0), gap: S.md }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} /> : undefined}>{children}</ScrollView>
    {footer && <View style={[st.footer, { paddingBottom: Math.max(inset.bottom, S.md) }]}>{footer}</View>}
  </View>;
}
export const Card = ({ children, style, onPress, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'warn' | 'crit' | 'good' }) => {
  const box = [st.card, tone && { borderColor: tone === 'warn' ? '#F1C363' : tone === 'crit' ? '#EFA9A2' : '#9AD5B1' }, style];
  return onPress ? <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [box, pressed && { opacity: 0.85 }]}>{children}</Pressable> : <View style={box}>{children}</View>;
};
export const H1 = ({ children }: { children: ReactNode }) => <Text style={T.h1}>{children}</Text>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={T.h2}>{children}</Text>;
export const P = ({ children, style }: { children: ReactNode; style?: any }) => <Text style={[T.body, style]}>{children}</Text>;
export const Sub = ({ children, style, lines }: { children: ReactNode; style?: any; lines?: number }) => <Text numberOfLines={lines} style={[T.sub, style]}>{children}</Text>;
export const Label = ({ children }: { children: ReactNode }) => <Text style={T.label}>{children}</Text>;
export const Num = ({ children, style }: { children: ReactNode; style?: any }) => <Text style={[T.body, T.num, { fontWeight: '700' }, style]}>{children}</Text>;
export const Row = ({ children, style, gap = S.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
export const Spread = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }, style]}>{children}</View>;

type Tone = 'good' | 'warn' | 'crit' | 'info' | 'plain';
const TONE: Record<Tone, [string, string]> = { good: [C.goodSoft, C.good], warn: [C.warnSoft, C.warn], crit: [C.critSoft, C.crit], info: [C.infoSoft, C.info], plain: [C.sunk, C.mute] };
export const Pill = ({ children, tone = 'plain' }: { children: ReactNode; tone?: Tone }) => <View style={{ backgroundColor: TONE[tone][0], paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, alignSelf: 'flex-start' }}><Text style={{ color: TONE[tone][1], fontSize: 12, fontWeight: '700' }}>{children}</Text></View>;
export const statusTone = (s: string): Tone => (s === 'Approved' || s === 'Accepted' || s === 'Verified' || s === 'Settled' ? 'good' : s === 'Pending' || s === 'Submitted' ? 'warn' : s === 'Rejected' || s === 'Cancelled' ? 'crit' : s === 'Dispatched' ? 'info' : 'plain');

export function Button({ title, onPress, kind = 'primary', busy, disabled, icon, small, style }: { title: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger' | 'soft'; busy?: boolean; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = kind === 'primary' ? C.accent : kind === 'soft' ? C.accentSoft : C.card, fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.crit : kind === 'soft' ? C.accentDark : C.ink, off = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={off} onPress={() => { tap(); onPress(); }}
    style={({ pressed }) => [{ backgroundColor: bg, borderRadius: R.md, minHeight: small ? 38 : 48, paddingHorizontal: small ? 12 : 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderWidth: kind === 'primary' || kind === 'soft' ? 0 : 1, borderColor: kind === 'danger' ? '#EFA9A2' : C.line }, pressed && { opacity: 0.8 }, off && { opacity: 0.5 }, style]}>
    {busy ? <ActivityIndicator color={fg} /> : <>{icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />}<Text style={{ color: fg, fontWeight: '700', fontSize: small ? 14 : 16 }}>{title}</Text></>}
  </Pressable>;
}
export function Field({ label, help, ...p }: TextInputProps & { label: string; help?: string }) {
  return <View style={{ gap: 6 }}><Label>{label}</Label>
    <TextInput accessibilityLabel={label} placeholderTextColor={C.faint} {...p} style={[st.input, p.multiline && { minHeight: 84, textAlignVertical: 'top' }, p.style]} />
    {help ? <Sub>{help}</Sub> : null}</View>;
}
export function Choice<T extends string>({ label, options, value, onChange }: { label?: string; options: readonly T[]; value: T | ''; onChange: (v: T) => void }) {
  return <View style={{ gap: 6 }}>{label ? <Label>{label}</Label> : null}<Row wrap>{options.map(o => { const on = o === value; return <Pressable key={o} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { tap(); onChange(o); }}
    style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: R.pill, borderWidth: 1, borderColor: on ? C.accent : C.line, backgroundColor: on ? C.accentSoft : C.card }}><Text style={{ color: on ? C.accentDark : C.ink, fontWeight: on ? '700' : '500' }}>{o}</Text></Pressable>; })}</Row></View>;
}
export const ErrorBox = ({ text }: { text: string }) => (text ? <View accessibilityRole="alert" style={{ backgroundColor: C.critSoft, borderRadius: R.md, padding: S.md }}><Text style={{ color: C.crit, fontWeight: '600' }}>{text}</Text></View> : null);
export const Note = ({ text, tone = 'info' }: { text: string; tone?: Tone }) => <View style={{ backgroundColor: TONE[tone][0], borderRadius: R.md, padding: S.md }}><Text style={{ color: TONE[tone][1], fontWeight: '600' }}>{text}</Text></View>;
/** Shown when the figures on screen are the ones saved on the phone, not fresh from the server. */
export const Stale = ({ at, show }: { at: number; show: boolean }) => (show ? <Note tone="warn" text={`No connection. Showing what was saved ${ago(at)}.`} /> : null);
export const Loading = () => <View style={{ padding: S.xl, alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>;
export const Empty = ({ icon = 'checkmark-circle-outline', title, text }: { icon?: keyof typeof Ionicons.glyphMap; title: string; text?: string }) => <View style={{ alignItems: 'center', padding: S.xl, gap: 6 }}><Ionicons name={icon} size={36} color={C.faint} /><Text style={[T.h2, { textAlign: 'center' }]}>{title}</Text>{text ? <Sub style={{ textAlign: 'center' }}>{text}</Sub> : null}</View>;
export const KV = ({ k, v }: { k: string; v: ReactNode }) => <View style={{ flex: 1, minWidth: 130, gap: 2 }}><Label>{k}</Label>{typeof v === 'string' || typeof v === 'number' ? <Num>{v}</Num> : v}</View>;
export const Line = () => <View style={{ height: 1, backgroundColor: C.line }} />;
export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const B = ({ d, icon }: { d: number; icon: 'remove' | 'add' }) => <Pressable accessibilityRole="button" accessibilityLabel={`${d > 0 ? 'More' : 'Fewer'} boxes of ${label}`} onPress={() => { tap(); onChange(Math.max(0, value + d)); }} style={st.step}><Ionicons name={icon} size={20} color={C.accentDark} /></Pressable>;
  return <Row gap={6}><B d={-1} icon="remove" /><TextInput accessibilityLabel={`Boxes of ${label}`} keyboardType="number-pad" value={value ? String(value) : ''} placeholder="0" placeholderTextColor={C.faint} onChangeText={t => onChange(Math.max(0, Math.min(99999, parseInt(t.replace(/\D/g, ''), 10) || 0)))} style={[st.input, { width: 72, textAlign: 'center', paddingHorizontal: 4 }]} /><B d={1} icon="add" /></Row>;
}
const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: S.lg, gap: S.sm, borderWidth: 1, borderColor: C.line, ...shadow },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: R.md, minHeight: 48, paddingHorizontal: 14, fontSize: 16, color: C.ink },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, padding: S.md, gap: S.sm },
  step: { width: 44, height: 48, borderRadius: R.md, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
