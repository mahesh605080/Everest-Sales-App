import { useState } from 'react';
import { call } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, ErrorBox, Field, Note, Screen } from '@/ui/kit';

export default function Password() {
  const { user, expire, signOut } = useSession(); const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function save() {
    if (next.length < 8) { setErr('The new password needs at least 8 characters.'); return; }
    if (next !== again) { setErr('The two new passwords are not the same.'); return; }
    setBusy(true); setErr('');
    try { await call('/api/auth/password', { json: { current: cur, next } }); await expire(); }
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
    <Note tone="plain" text="After the change you log in again with the new password." />
  </Screen>;
}
