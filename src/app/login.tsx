import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorBox, Field, Sub } from '@/ui/kit';
import { C, R, S, T } from '@/theme';

export default function Login() {
  const { signIn, server } = useSession(); const inset = useSafeAreaInsets();
  const [srv, setSrv] = useState(server); const [login, setLogin] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const needServer = Platform.OS !== 'web';
  async function go() {
    if (needServer && !srv.trim()) { setErr('Enter the server address your company gave you.'); return; }
    if (!login.trim() || !pw) { setErr('Enter your employee code or mobile number, and your password.'); return; }
    setBusy(true); setErr('');
    try { await signIn(srv, login.trim(), pw); } catch (e: any) { setErr(e?.message ?? 'Could not log in.'); } finally { setBusy(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: S.xl, paddingTop: inset.top + S.xl, gap: S.xl }}>
      <View style={{ gap: S.sm }}>
        <View style={{ width: 56, height: 56, borderRadius: R.lg, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>EP</Text></View>
        <Text style={[T.h1, { fontSize: 28 }]}>Everest Sales</Text>
        <Sub>Everest Parenterals Pvt. Ltd. · orders, visits and collections from the field</Sub>
      </View>
      <Card style={{ gap: S.md }}>
        {needServer && <Field label="Server address" value={srv} onChangeText={setSrv} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="sales.yourcompany.com" help="Ask the office once. The app remembers it." />}
        <Field label="Employee code or mobile number" value={login} onChangeText={setLogin} autoCapitalize="characters" autoCorrect={false} placeholder="SO01" returnKeyType="next" />
        <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry placeholder="Password" returnKeyType="go" onSubmitEditing={go} />
        <ErrorBox text={err} />
        <Button title="Log in" onPress={go} busy={busy} icon="log-in-outline" />
      </Card>
      <Sub style={{ textAlign: 'center' }}>Forgot the password? Ask the Admin to set a new one.</Sub>
    </ScrollView>
  </KeyboardAvoidingView>;
}
