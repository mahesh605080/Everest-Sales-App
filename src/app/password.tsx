import { useState } from 'react';
import { useRouter } from 'expo-router';
import { call, setTokens } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorBox, Field, Note, Screen } from '@/ui/kit';

export default function Password() {
  const { user, expire, signOut, refreshUser } = useSession(); const router = useRouter(); const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    if (next.length < 8) { setErr('The new password needs at least 8 characters.'); return; }
    if (next !== again) { setErr('The two new passwords are not the same.'); return; }
    setBusy(true); setErr('');
    try { const r = await call<{ access_token?: string }>('/api/v1/auth/password', { json: { current: cur, next } }); if (r.access_token) { await setTokens(r.access_token); await refreshUser(); router.replace('/'); } else await expire(); }
    catch (e: any) { setErr(e?.message ?? 'Could not change the password.'); } finally { setBusy(false); }
  }
  return <Screen>
    {user?.must_change_password && <Note text="You are using a temporary password. Choose your own to continue." />}
    <Card style={{ gap: 12 }}>
      <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry />
      <Field label="New password" value={next} onChangeText={setNext} secureTextEntry help="At least 8 characters." />
      <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry />
      <ErrorBox text={err} />
      <Button title="Change password" onPress={save} busy={busy} />
      <Button title="Log out" kind="plain" onPress={signOut} />
    </Card>
    <Note tone="plain" text="Every other phone or browser where you are logged in is signed out. This phone stays logged in." />
  </Screen>;
}
