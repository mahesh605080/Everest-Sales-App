import { useState } from 'react';
import { Text, View } from 'react-native';
import { ago } from '@/lib/format';
import { removeItem, retryItem, sync, useOutbox } from '@/lib/outbox';
import { Button, Card, Empty, Note, Pill, Row, Screen, Spread, Sub } from '@/ui/kit';
import { T } from '@/theme';

export default function Outbox() {
  const list = useOutbox(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  async function go() { setBusy(true); setMsg(''); try { const r = await sync(); setMsg(r.sent ? `${r.sent} sent.${r.left ? ` ${r.left} still here.` : ''}` : r.left ? 'Nothing could be sent. Check the connection.' : ''); } finally { setBusy(false); } }
  return <Screen onRefresh={go} refreshing={busy}>
    <Sub>Work saved on this phone because there was no connection. It is sent by itself when the phone is online; nothing is booked twice.</Sub>
    {msg ? <Note text={msg} /> : null}
    {!list.length && <Card><Empty icon="cloud-done-outline" title="Everything has been sent" /></Card>}
    {list.map(it => <Card key={it.ref} tone={it.error ? 'crit' : 'warn'}>
      <Spread style={{ alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 2 }}><Text style={T.h2}>{it.title}</Text><Sub>{it.sub}</Sub><Sub>saved {ago(it.at)}{it.tries ? ` · tried ${it.tries} ${it.tries === 1 ? 'time' : 'times'}` : ''}</Sub></View><Pill tone={it.error ? 'crit' : 'warn'}>{it.error ? 'Refused' : 'Waiting'}</Pill></Spread>
      {it.error ? <><Note tone="crit" text={`The office system did not accept it: ${it.error}`} /><Row><Button small style={{ flex: 1 }} title="Try again" onPress={() => retryItem(it.ref)} /><Button small style={{ flex: 1 }} kind="danger" title="Delete" onPress={() => removeItem(it.ref)} /></Row></> : null}
    </Card>)}
    {list.some(x => !x.error) && <Button title="Send now" icon="cloud-upload-outline" busy={busy} onPress={go} />}
  </Screen>;
}
