'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';

type Opt = { id?: number; key?: string; name: string; role?: string };
const CATS: [string, string][] = [['general', 'General'], ['announcements', 'Announcement'], ['orders', 'Orders and credit'], ['approvals', 'Approvals'], ['collections', 'Collections'], ['stock', 'Stock and expiry']];
// The words say exactly how far each message got. "Accepted" is the push service taking it; only "Shown on device" is the device itself confirming.
const STATE: Record<string, string> = { 'inapp:stored': 'In the inbox', 'inapp:skipped': 'Held back', queued: 'Waiting to send', processing: 'Sending', accepted: 'Accepted by push service', confirmed: 'Shown on device', failed: 'Will retry', dead: 'Could not be sent', expired: 'Expired unsent', skipped: 'Withdrawn' };
const when = (v: string) => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
const label = (k: string) => STATE[k] || STATE[k.split(':')[1]] || k;
const fold = (d: Record<string, number>) => { const out: Record<string, number> = {}; for (const [k, n] of Object.entries(d)) { const l = label(k); out[l] = (out[l] || 0) + n; } return Object.entries(out); };

export default function NotifySend({ broadcast, manage, people, roles, areas, regions }: { broadcast: boolean; manage: boolean; people: Opt[]; roles: Opt[]; areas: Opt[]; regions: Opt[] }) {
  const [f, setF] = useState({ title: '', body: '', category: 'general', url: '', kind: 'users', ids: [] as number[], key: roles[0]?.key || '', area: areas[0]?.id || 0, region: regions[0]?.id || 0, urgent: false, at: '' });
  const [find, setFind] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [hist, setHist] = useState<any[] | null>(null); const [open, setOpen] = useState<any>(null);
  const [attempt] = useState(() => ({ key: crypto.randomUUID() }));
  const load = useCallback(() => call('/api/v1/notifications?limit=30').then(r => setHist(r.notifications)).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (f.kind === 'users' && !f.ids.length) { setErr('Choose at least one person.'); return; }
    if (f.kind === 'all' && !confirm('Send this to everyone in the company?')) return;
    const audience = f.kind === 'users' ? { kind: 'users', ids: f.ids } : f.kind === 'role' ? { kind: 'role', key: f.key } : f.kind === 'area' ? { kind: 'area', id: Number(f.area) } : f.kind === 'region' ? { kind: 'region', id: Number(f.region) } : { kind: 'all' };
    setBusy(true);
    try {
      // The key makes a double click or a retry after a lost answer send once, not twice.
      const r = await call('/api/v1/notifications', { method: 'POST', headers: { 'idempotency-key': attempt.key }, json: { title: f.title, body: f.body || null, category: f.category, url: f.url || null, audience, priority: f.urgent ? 1 : 5, scheduled_at: f.at ? new Date(f.at).toISOString() : null } });
      attempt.key = crypto.randomUUID();
      const n = Object.values(r.deliveries as Record<string, number>).reduce((a, b) => a + b, 0);
      toast(r.status === 'scheduled' ? 'Scheduled.' : n ? `Sent to ${r.deliveries['inapp:stored'] || 0} ${r.deliveries['inapp:stored'] === 1 ? 'person' : 'people'}.` : 'Nobody matched, so nothing was sent.');
      setF(x => ({ ...x, title: '', body: '', url: '', ids: [], at: '', urgent: false })); load();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  async function act(path: string, done: string) { setErr(''); try { await call(path, { method: 'POST' }); toast(done); load(); setOpen(null); } catch (e: any) { setErr(e.message); } }
  const shown = people.filter(p => !find || (p.name + ' ' + p.role).toLowerCase().includes(find.toLowerCase())).slice(0, 40);
  const kinds = [['users', 'Chosen people'], ...(broadcast ? [['role', 'A role'], ['area', 'An area'], ['region', 'A region'], ['all', 'Everyone']] : [])];
  return <>
    <form className="card" onSubmit={send}>
      <h2>Send a notification</h2>
      <p className="sub">It appears under the bell at once, and as a push on devices where the person has switched notifications on.</p>
      {err && <div className="errbox" role="alert">{err}</div>}
      <div className="fld"><label htmlFor="n-title">Title</label><input id="n-title" type="text" required maxLength={150} value={f.title} onChange={e => set('title', e.target.value)} /></div>
      <div className="fld"><label htmlFor="n-body">Message</label><textarea id="n-body" rows={3} maxLength={500} value={f.body} onChange={e => set('body', e.target.value)} /></div>
      <div className="g" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="fld"><label htmlFor="n-cat">Kind</label><select id="n-cat" value={f.category} onChange={e => set('category', e.target.value)}>{CATS.map(c => <option key={c[0]} value={c[0]}>{c[1]}</option>)}</select><small>People can switch off kinds they do not want.</small></div>
        <div className="fld"><label htmlFor="n-url">Opens page (optional)</label><input id="n-url" type="text" placeholder="/orders" maxLength={300} value={f.url} onChange={e => set('url', e.target.value)} /><small>A page of this app, starting with /.</small></div>
      </div>
      <div className="fld"><label htmlFor="n-kind">Send to</label><select id="n-kind" value={f.kind} onChange={e => set('kind', e.target.value)}>{kinds.map(k => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
      {f.kind === 'users' && <div className="fld"><label htmlFor="n-find">People ({f.ids.length} chosen)</label><input id="n-find" type="text" placeholder="Search by name or role" value={find} onChange={e => setFind(e.target.value)} />
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 6, marginTop: 6 }}>{shown.map(p => <label key={p.id} className="chk" style={{ display: 'flex' }}><input type="checkbox" checked={f.ids.includes(p.id!)} onChange={e => set('ids', e.target.checked ? [...f.ids, p.id] : f.ids.filter(i => i !== p.id))} /> {p.name} <span className="code">{p.role}</span></label>)}</div></div>}
      {f.kind === 'role' && <div className="fld"><label htmlFor="n-role">Role</label><select id="n-role" value={f.key} onChange={e => set('key', e.target.value)}>{roles.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}</select></div>}
      {f.kind === 'area' && <div className="fld"><label htmlFor="n-area">Area</label><select id="n-area" value={f.area} onChange={e => set('area', e.target.value)}>{areas.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>}
      {f.kind === 'region' && <div className="fld"><label htmlFor="n-region">Region</label><select id="n-region" value={f.region} onChange={e => set('region', e.target.value)}>{regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>}
      <div className="g" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="fld"><label htmlFor="n-at">Send later (optional)</label><input id="n-at" type="datetime-local" value={f.at} onChange={e => set('at', e.target.value)} /><small>Leave empty to send now.</small></div>
        <div className="fld"><label className="chk"><input type="checkbox" checked={f.urgent} onChange={e => set('urgent', e.target.checked)} /> Urgent</label><small>Goes through even in a person's quiet hours. Use rarely.</small></div>
      </div>
      <div><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : f.at ? 'Schedule' : 'Send'}</button></div>
    </form>
    <section className="card">
      <div className="hd"><h2>Sent by hand</h2><button className="btn sm" onClick={load}>Refresh</button></div>
      {!hist ? <p className="sub">Loading…</p> : !hist.length ? <p className="sub">Nothing sent yet.</p> :
        <div className="tbl"><table><thead><tr><th>Notification</th><th>When</th><th>What happened</th><th /></tr></thead>
          <tbody>{hist.map(n => <tr key={n.id}><td><b>{n.title}</b>{n.body && <><br /><span className="sub">{n.body}</span></>}<br /><span className="code">{n.audience.kind === 'users' ? `${n.audience.ids.length} ${n.audience.ids.length === 1 ? 'person' : 'people'}` : n.audience.kind === 'all' ? 'everyone' : n.audience.kind ? `${n.audience.kind} ${n.audience.key || n.audience.id}` : ''}{n.priority <= 1 ? ' · urgent' : ''}</span></td>
            <td className="num">{n.status === 'scheduled' ? `Scheduled for ${when(n.scheduled_at)}` : n.status === 'cancelled' ? 'Cancelled' : when(n.created_at)}</td>
            <td>{fold(n.deliveries).map(([k, v]) => <div key={k}><span className="num">{v}</span> {k}</div>)}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm" onClick={async () => { try { setOpen(await call(`/api/v1/notifications/${n.id}`)); } catch (e: any) { setErr(e.message); } }}>Details</button>
              {(n.status === 'scheduled' || Object.keys(n.deliveries).some(k => /:(queued|failed)$/.test(k))) && <> <button className="btn sm danger" onClick={() => act(`/api/v1/notifications/${n.id}/cancel`, n.status === 'scheduled' ? 'Cancelled.' : 'Unsent push withdrawn.')}>{n.status === 'scheduled' ? 'Cancel' : 'Withdraw unsent'}</button></>}</td></tr>)}</tbody></table></div>}
    </section>
    {open && <section className="card">
      <div className="hd"><h2>{open.title}</h2><div>{manage && open.attempts.some((a: any) => ['dead', 'failed', 'expired'].includes(a.status) && a.channel !== 'inapp') && <button className="btn sm" onClick={() => act(`/api/v1/notifications/${open.id}/retry`, 'Queued again.')}>Send failed ones again</button>} <button className="btn sm" onClick={() => setOpen(null)}>Close</button></div></div>
      <div className="tbl"><table><thead><tr><th>Person</th><th>Where</th><th>Result</th><th className="r">Tries</th><th>Note</th></tr></thead>
        <tbody>{open.attempts.map((a: any) => <tr key={a.id}><td>{a.user_name}</td><td>{a.channel === 'inapp' ? 'Inbox' : a.channel === 'webpush' ? 'Browser push' : 'iPhone push'}</td>
          <td>{label(`${a.channel}:${a.status}`)}{a.clicked_at ? ' · opened' : ''}</td><td className="r num">{a.channel === 'inapp' ? '' : a.attempts}</td><td className="sub">{a.last_error || ''}</td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
