'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';

/** The Super Admin's view of the platform service. Everything here reads from, or acts through, the service's own admin API; nothing is computed in the browser. */
const A = '/api/v1/admin';
const TABS = [['overview', 'Overview'], ['logins', 'Logins'], ['jobs', 'Jobs and schedules'], ['notify', 'Notifications'], ['storage', 'Storage'], ['db', 'Database'], ['traffic', 'Live and requests']] as const;
type Tab = typeof TABS[number][0];
const size = (n: number) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');
const when = (v: any) => (v ? new Date(typeof v === 'number' ? v * 1000 : v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }) : '–');
const span = (s: number | null | undefined) => (s == null ? '–' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
const every = (s: any) => (s.daily_at ? `Daily at ${s.daily_at}` : `Every ${span(s.every_seconds)}`);
const TONE: Record<string, string> = { done: 'good', queued: 'info', running: 'info', dead: 'crit', cancelled: '', retrying: 'warn', success: 'good', critical: 'crit', warning: 'warn' };
const WORD: Record<string, string> = { dead: 'failed', done: 'done', queued: 'waiting', running: 'running', cancelled: 'cancelled', retrying: 'will retry' };
const Pill = ({ s, children }: { s: string; children?: React.ReactNode }) => <span className={`pill ${TONE[s] ?? ''}`}>{children ?? WORD[s] ?? s}</span>;
const Kpi = ({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'crit' }) =>
  <div className="card"><span className="sub">{label}</span><b style={{ fontSize: 20, color: tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : undefined }}>{value}</b>{sub && <span className="sub">{sub}</span>}</div>;

function useLoad<T = any>(url: string | null, everyMs = 0) {
  const [d, setD] = useState<T | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => { if (url) call<T>(url).then(r => { setD(r); setErr(''); }).catch(e => setErr(e.message)); }, [url]);
  useEffect(() => { setD(null); load(); if (!everyMs) return; const t = setInterval(load, everyMs); return () => clearInterval(t); }, [load, everyMs]);
  return { d, err, load };
}
const Err = ({ text }: { text: string }) => (text ? <div className="errbox" role="alert">{text}</div> : null);
async function act(fn: () => Promise<any>, done: string, after: () => void, setErr: (s: string) => void) { setErr(''); try { await fn(); toast(done); after(); } catch (e: any) { setErr(e.message); } }

function Overview() {
  const { d, err, load } = useLoad<any>(`${A}/monitor`, 15000); const [e2, setE2] = useState('');
  if (!d) return <section className="card"><Err text={err} />{!err && <p className="sub">Loading…</p>}</section>;
  const mig = d.database.migrations, w = d.worker, q = d.notifications, j = d.jobs.last_7_days, c = d.database.connections, st = d.storage, ch = d.configuration.channels;
  const stale = !w.running || (w.notify.seconds_since_last ?? 999) > 60;
  const waiting = (q.last_7_days.queued || 0) + (q.last_7_days.failed || 0);
  return <>
    <Err text={err || e2} />
    {d.alerts.length > 0 && <section className="card"><h2>Needs attention</h2>
      {d.alerts.map((a: any) => <div key={a.id} className="hd"><div><Pill s={a.severity} /> <b>{a.message}</b><br /><span className="sub">Since {when(a.first_seen_at)} · seen {a.count} times{a.acknowledged_at ? ' · marked as seen' : ''}</span></div>
        {!a.acknowledged_at && <button className="btn sm" onClick={() => act(() => call(`${A}/alerts/${a.id}/acknowledge`, { method: 'POST' }), 'Marked as seen.', load, setE2)}>Mark as seen</button>}</div>)}
      <p className="sub">An alert closes by itself when the problem is gone.</p></section>}
    <div className="g kpi">
      <Kpi label="Service" value={d.alerts.some((a: any) => a.severity === 'critical') ? 'Problem' : d.alerts.length ? 'Warnings' : 'Healthy'} tone={d.alerts.some((a: any) => a.severity === 'critical') ? 'crit' : d.alerts.length ? 'warn' : 'good'} sub={`Running ${span(d.api.uptime_seconds)} · ${d.environment}`} />
      <Kpi label="Database" value={size(d.database.bytes)} sub={`${c.total} of ${c.max} connections`} tone={c.total / c.max > 0.8 ? 'warn' : undefined} />
      <Kpi label="Database version" value={mig.platform.up_to_date ? 'Up to date' : 'Behind'} tone={mig.platform.up_to_date ? undefined : 'crit'} sub={`Platform ${mig.platform.current ?? 'none'} · web ${String(mig.web.last_applied || '').slice(0, 3)}`} />
      <Kpi label="Background worker" value={stale ? 'Not running' : 'Running'} tone={stale ? 'crit' : undefined} sub={w.running ? `Last pass ${span(w.notify.seconds_since_last)} ago` : 'Started with the service'} />
      <Kpi label="Jobs, 7 days" value={`${j.done || 0} done`} sub={`${j.dead || 0} failed · ${j.queued || 0} waiting`} tone={j.dead ? 'warn' : undefined} />
      <Kpi label="Push waiting" value={waiting} sub={waiting ? `Oldest ${span(q.oldest_due_seconds)}` : `${q.last_7_days.dead || 0} could not be sent, 7 days`} tone={q.oldest_due_seconds > 600 ? 'warn' : undefined} />
      <Kpi label="Online now" value={d.realtime.people_online} sub={`${d.realtime.connections} connections · ${d.realtime.listening ? 'listening' : 'not listening'}`} tone={d.realtime.listening ? undefined : 'crit'} />
      <Kpi label="Files" value={size(st.bytes)} sub={`${st.files} files · disk ${size(st.disk_free_bytes)} free`} tone={st.disk_free_bytes / st.disk_total_bytes < 0.1 ? 'warn' : undefined} />
      <Kpi label="Last backup" value={d.backup?.last ? when(d.backup.last.at) : 'None recorded'} tone={!d.backup?.last || d.backup?.verified?.ok === false ? 'warn' : undefined}
        sub={d.backup?.last ? `${size(d.backup.last.database_bytes + (d.backup.last.files_bytes || 0))} · ${d.backup.verified ? (d.backup.verified.ok ? `test-restored ${when(d.backup.verified.at)}` : 'test restore FAILED') : 'never test-restored'}` : 'See the deployment guide'} />
      <Kpi label="Requests" value={d.api.requests} sub={`${d.api.server_errors} server errors since start`} tone={d.api.server_errors ? 'warn' : undefined} />
    </div>
    <section className="card"><h2>What is switched on</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['Browser push', ch.webpush], ['iPhone push', ch.apns], ['Password-reset email', ch.email], ['Field alert rules on a schedule', ch.web_alert_rules]].map(([n, on]) => <span key={String(n)} className={`pill ${on ? 'good' : ''}`}>{n}: {on ? 'on' : 'off'}</span>)}</div>
      {d.configuration.problems.length > 0 && <><h2 style={{ marginTop: 8 }}>Configuration to fix</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{d.configuration.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></>}
      <p className="sub">Channels are switched on with settings on the server, never from this screen. See the notifications guide in the project documents.</p></section>
  </>;
}

function Logins() {
  const s = useLoad<any>(`${A}/sessions`); const [outcome, setOutcome] = useState(''); const h = useLoad<any>(`${A}/login-events?limit=100${outcome ? `&outcome=${outcome}` : ''}`); const [err, setErr] = useState('');
  const OUT = ['success', 'wrong_password', 'unknown_user', 'locked_out', 'rate_limited', 'logout', 'ended_by_admin', 'refresh_reuse', 'reset_issued', 'reset_done'];
  return <>
    <section className="card"><div className="hd"><h2>Logged in now</h2><span className="sub">{s.d ? Object.entries(s.d.by_client).map(([k, v]) => `${v} ${k}`).join(' · ') || 'nobody' : ''}</span></div><Err text={s.err || err} />
      {!s.d ? <p className="sub">Loading…</p> : <div className="tbl"><table><thead><tr><th>Person</th><th>On</th><th>Address</th><th>Since</th><th>Last used</th><th /></tr></thead>
        <tbody>{s.d.sessions.map((x: any) => <tr key={x.id}><td><b>{x.user_name}</b><br /><span className="code">{x.user_code} · {x.role_name}</span></td><td>{x.client}{x.device ? ` · ${x.device}` : ''}<br /><span className="sub" style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.user_agent || ''}</span></td>
          <td className="code">{x.ip || '–'}</td><td className="num">{when(x.created_at)}</td><td className="num">{when(x.last_used_at)}</td>
          <td><button className="btn sm danger" onClick={() => { if (confirm(`End this login of ${x.user_name}? They will have to log in again on that device.`)) act(() => call(`${A}/sessions/${x.id}`, { method: 'DELETE' }), 'Login ended.', s.load, setErr); }}>End</button></td></tr>)}
          {!s.d.sessions.length && <tr><td colSpan={6}><p className="sub">Nobody is logged in.</p></td></tr>}</tbody></table></div>}</section>
    <section className="card"><div className="toolbar"><div className="l"><h2>Security history</h2></div><div className="r"><select aria-label="Show" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Everything</option>{OUT.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select></div></div><Err text={h.err} />
      {!h.d ? <p className="sub">Loading…</p> : <div className="tbl"><table><thead><tr><th>When</th><th>Login</th><th>What</th><th>Address</th><th>Note</th></tr></thead>
        <tbody>{h.d.events.map((e: any) => <tr key={e.id}><td className="num">{when(e.at)}</td><td>{e.login || (e.user_id ? `#${e.user_id}` : '–')}</td><td><span className={`pill ${e.outcome === 'success' ? 'good' : /wrong|unknown|locked|limited|reuse|refused|inactive/.test(e.outcome) ? 'crit' : 'info'}`}>{e.outcome.replace(/_/g, ' ')}</span></td><td className="code">{e.ip || '–'}</td><td className="sub">{e.detail || ''}</td></tr>)}
          {!h.d.events.length && <tr><td colSpan={5}><p className="sub">Nothing recorded.</p></td></tr>}</tbody></table></div>}
      <p className="sub">Changes to records are in the <Link href="/audit">audit log</Link>.</p></section>
  </>;
}

function Jobs() {
  const sc = useLoad<any>(`${A}/schedules`, 20000); const [status, setStatus] = useState(''); const jb = useLoad<any>(`${A}/jobs?limit=60${status ? `&status=${status}` : ''}`, 20000); const [err, setErr] = useState('');
  const both = () => { sc.load(); jb.load(); };
  return <>
    <section className="card"><h2>Schedules</h2><Err text={sc.err || err} />
      {!sc.d ? <p className="sub">Loading…</p> : <div className="tbl"><table><thead><tr><th>Work</th><th>Runs</th><th>Next</th><th>Last</th><th /></tr></thead>
        <tbody>{sc.d.schedules.map((s: any) => <tr key={s.name}><td><b>{s.label}</b><br /><span className="code">{Object.entries(s.payload).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') || s.kind}</span></td><td>{every(s)}</td>
          <td className="num">{s.enabled ? when(s.next_run_at) : <span className="pill">off</span>}</td><td className="num">{s.last_run_at ? <>{when(s.last_run_at)} <Pill s={s.last_status || 'done'} /></> : 'never'}</td>
          <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm" onClick={() => act(() => call(`${A}/schedules/${s.name}/run`, { method: 'POST' }), 'Queued. It runs within a few seconds.', both, setErr)}>Run now</button>{' '}
            <button className="btn sm" onClick={() => act(() => call(`${A}/schedules/${s.name}`, { method: 'PATCH', json: { enabled: !s.enabled } }), s.enabled ? 'Switched off.' : 'Switched on.', both, setErr)}>{s.enabled ? 'Switch off' : 'Switch on'}</button></td></tr>)}</tbody></table></div>}
      <p className="sub">Times are Nepal time. Only work that is built into the system can be scheduled; there is no way to run a command from here.</p></section>
    <section className="card"><div className="toolbar"><div className="l"><h2>Recent jobs</h2></div><div className="r"><select aria-label="Show jobs" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option><option value="dead">Failed</option><option value="queued">Waiting</option><option value="done">Done</option></select></div></div><Err text={jb.err} />
      {!jb.d ? <p className="sub">Loading…</p> : <div className="tbl"><table><thead><tr><th>Job</th><th>State</th><th className="r">Tries</th><th>When</th><th>Result</th><th /></tr></thead>
        <tbody>{jb.d.jobs.map((j: any) => <tr key={j.id}><td>{j.label}<br /><span className="code">#{j.id}{j.schedule ? ' · scheduled' : ' · by hand'}</span></td><td><Pill s={j.status} /></td><td className="r num">{j.attempts}/{j.max_attempts}</td>
          <td className="num">{when(j.finished_at || j.started_at || j.run_at)}{j.seconds != null ? ` · ${j.seconds} s` : ''}</td>
          <td className="sub" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{j.last_error || (j.result ? Object.entries(j.result).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '')}</td>
          <td>{j.status === 'dead' && <button className="btn sm" onClick={() => act(() => call(`${A}/jobs/${j.id}/retry`, { method: 'POST' }), 'Queued again.', both, setErr)}>Run again</button>}{j.status === 'queued' && <button className="btn sm" onClick={() => act(() => call(`${A}/jobs/${j.id}/cancel`, { method: 'POST' }), 'Cancelled.', both, setErr)}>Cancel</button>}</td></tr>)}
          {!jb.d.jobs.length && <tr><td colSpan={6}><p className="sub">No jobs yet.</p></td></tr>}</tbody></table></div>}</section>
  </>;
}

function Notify() {
  const q = useLoad<any>(`${A}/notify/queue`, 15000); const dv = useLoad<any>(`${A}/push/subscriptions?limit=200`); const [err, setErr] = useState('');
  const L: [string, string][] = [['stored', 'In the inbox'], ['queued', 'Waiting to send'], ['accepted', 'Accepted by push service'], ['confirmed', 'Shown on device'], ['failed', 'Will retry'], ['dead', 'Could not be sent'], ['expired', 'Expired unsent'], ['skipped', 'Push held back or withdrawn']];
  return <>
    <section className="card"><div className="hd"><h2>Last 7 days</h2><Link className="btn sm primary" href="/notify">Send a notification</Link></div><Err text={q.err || err} />
      {!q.d ? <p className="sub">Loading…</p> : <><div className="g kpi">{L.map(([k, n]) => <Kpi key={k} label={n} value={q.d.last_7_days[k] || 0} tone={k === 'dead' && q.d.last_7_days[k] ? 'warn' : undefined} />)}</div>
        <p className="sub">{q.d.scheduled} scheduled for later · oldest waiting {span(q.d.oldest_due_seconds)} · browser push {q.d.channels.webpush ? 'on' : 'off'} · iPhone push {q.d.channels.apns ? 'on' : 'off'}.
          “Accepted” means the push service took the message; only “Shown on device” is the device itself confirming.</p></>}</section>
    <section className="card"><h2>Devices registered for push</h2><Err text={dv.err} />
      {!dv.d ? <p className="sub">Loading…</p> : <div className="tbl"><table><thead><tr><th>Person</th><th>Device</th><th>Registered</th><th>Last success</th><th>State</th><th /></tr></thead>
        <tbody>{dv.d.subscriptions.map((s: any) => <tr key={s.id}><td>#{s.user_id}</td><td>{s.channel === 'apns' ? 'iPhone' : 'Browser'} · {s.service}<br /><span className="sub" style={{ display: 'inline-block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.user_agent || ''}</span></td>
          <td className="num">{when(s.created_at)}</td><td className="num">{when(s.last_success_at)}</td><td>{s.active ? <span className="pill good">on</span> : <span className="pill">{s.revoked_reason || 'off'}</span>}{s.failures > 0 && <span className="sub"> {s.failures} failures</span>}</td>
          <td>{s.active && <button className="btn sm danger" onClick={() => act(() => call(`${A}/push/subscriptions/${s.id}/disable`, { method: 'POST' }), 'Switched off.', dv.load, setErr)}>Switch off</button>}</td></tr>)}
          {!dv.d.subscriptions.length && <tr><td colSpan={6}><p className="sub">No device has switched notifications on yet. People do that under My account.</p></td></tr>}</tbody></table></div>}</section>
  </>;
}

function Storage() {
  const u = useLoad<any>(`${A}/files/usage`);
  return <section className="card"><h2>File storage</h2><Err text={u.err} />
    {!u.d ? <p className="sub">Loading…</p> : <>
      <div className="g kpi"><Kpi label="Stored" value={size(Number(u.d.total.bytes))} sub={`${u.d.total.files} files`} /><Kpi label="Deleted, waiting to be removed" value={size(Number(u.d.total.waiting_purge))} sub="Removed for good after 7 days" /><Kpi label="Allowance per person" value={size(u.d.default_quota_bytes)} /></div>
      <div className="g half"><div className="tbl"><table><thead><tr><th>Type</th><th className="r">Files</th><th className="r">Size</th></tr></thead><tbody>{u.d.by_type.map((t: any) => <tr key={t.content_type}><td>{t.content_type}</td><td className="r num">{t.files}</td><td className="r num">{size(Number(t.bytes))}</td></tr>)}{!u.d.by_type.length && <tr><td colSpan={3}><p className="sub">No files yet.</p></td></tr>}</tbody></table></div>
        <div className="tbl"><table><thead><tr><th>Person</th><th className="r">Files</th><th className="r">Used</th><th className="r">Allowance</th></tr></thead><tbody>{u.d.people.map((p: any) => <tr key={p.id}><td>{p.name} <span className="code">{p.code}</span></td><td className="r num">{p.files}</td><td className="r num">{size(Number(p.bytes))}</td><td className="r num">{size(Number(p.limit_bytes))}</td></tr>)}{!u.d.people.length && <tr><td colSpan={4}><p className="sub">Nobody has stored a file.</p></td></tr>}</tbody></table></div></div></>}
  </section>;
}

function Database() {
  const o = useLoad<any>(`${A}/db/overview`); const [open, setOpen] = useState<{ schema: string; table: string } | null>(null); const t = useLoad<any>(open ? `${A}/db/tables/${open.schema}/${open.table}?limit=25` : null);
  const cell = (v: any) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80));
  return <>
    <section className="card"><h2>Database</h2><Err text={o.err} />
      {!o.d ? <p className="sub">Loading…</p> : <>
        <p className="sub">PostgreSQL {String(o.d.version).split(' ')[0]} · {size(o.d.database_bytes)} · platform tables at version {o.d.migrations.platform.current} ({o.d.migrations.platform.up_to_date ? 'up to date' : `code expects ${o.d.migrations.platform.head}`}) · web tables at {o.d.migrations.web.last_applied}</p>
        <div className="tbl" style={{ maxHeight: 420, overflowY: 'auto' }}><table><thead><tr><th>Table</th><th className="r">Rows (about)</th><th className="r">Size</th><th className="r">Index reads</th><th className="r">Full reads</th><th /></tr></thead>
          <tbody>{o.d.tables.map((x: any) => <tr key={x.schema + x.table}><td><span className="code">{x.schema}.</span>{x.table}</td><td className="r num">{x.rows_estimate}</td><td className="r num">{size(x.bytes)}</td><td className="r num">{x.index_scans}</td><td className="r num">{x.seq_scans}</td>
            <td><button className="btn sm" onClick={() => setOpen({ schema: x.schema, table: x.table })}>Look</button></td></tr>)}</tbody></table></div>
        <p className="sub">Read-only. Passwords, tokens and keys are never shown. There is no place to type SQL.</p></>}</section>
    {open && <section className="card"><div className="hd"><h2>{open.schema}.{open.table}</h2><button className="btn sm" onClick={() => setOpen(null)}>Close</button></div><Err text={t.err} />
      {!t.d ? <p className="sub">Loading…</p> : <div className="tbl" style={{ overflowX: 'auto' }}><table><thead><tr>{t.d.columns.map((c: any) => <th key={c.column_name}>{c.column_name}</th>)}</tr></thead>
        <tbody>{t.d.rows.map((r: any, i: number) => <tr key={i}>{t.d.columns.map((c: any) => <td key={c.column_name} className="code" style={{ whiteSpace: 'nowrap' }}>{c.hidden ? '•••' : cell(r[c.column_name])}</td>)}</tr>)}
          {!t.d.rows.length && <tr><td colSpan={t.d.columns.length}><p className="sub">Empty.</p></td></tr>}</tbody></table></div>}
      <p className="sub">The newest 25 records.</p></section>}
  </>;
}

function Traffic() {
  const m = useLoad<any>(`${A}/monitor`, 15000);
  if (!m.d) return <section className="card"><Err text={m.err} />{!m.err && <p className="sub">Loading…</p>}</section>;
  const r = m.d.realtime, a = m.d.api;
  const Rows = ({ rows }: { rows: any[] }) => <div className="tbl"><table><thead><tr><th>Request</th><th className="r">Count</th><th className="r">Average</th><th className="r">Slowest</th><th className="r">Refused</th><th className="r">Errors</th></tr></thead>
    <tbody>{rows.map((x: any) => <tr key={x.method + x.route}><td><span className="code">{x.method}</span> {x.route}</td><td className="r num">{x.requests}</td><td className="r num">{x.avg_ms} ms</td><td className="r num">{x.max_ms} ms</td><td className="r num">{x.client_errors}</td><td className="r num" style={{ color: x.server_errors ? 'var(--crit)' : undefined }}>{x.server_errors}</td></tr>)}</tbody></table></div>;
  return <>
    <section className="card"><h2>Live connections</h2>
      <div className="g kpi"><Kpi label="People online" value={r.people_online} sub={`${r.connections} connections`} /><Kpi label="Listening to the database" value={r.listening ? 'Yes' : 'No'} tone={r.listening ? undefined : 'crit'} sub={`${r.listener_restarts} restarts`} /><Kpi label="Events passed on" value={r.events_dispatched} sub={`${r.messages_sent} messages sent`} /><Kpi label="Dropped for being too slow" value={r.dropped_slow} sub={`${r.connections_total} connections since start`} /></div>
      <p className="sub">Figures are for this service process since it started {span(a.uptime_seconds)} ago.</p></section>
    <section className="card"><h2>Slowest requests</h2><Rows rows={a.slowest} /></section>
    <section className="card"><h2>Busiest requests</h2><Rows rows={a.busiest} /><p className="sub">“Refused” counts answers such as not logged in, not allowed, or wrong input. “Errors” are faults in the service.</p></section>
  </>;
}

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { const h = location.hash.slice(1) as Tab; if (TABS.some(t => t[0] === h)) setTab(h); }, []);
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', `#${t}`); };
  return <>
    <section className="card"><div className="toolbar"><div className="l" role="tablist" aria-label="Platform sections">{TABS.map(t => <button key={t[0]} role="tab" aria-selected={tab === t[0]} className={`btn ${tab === t[0] ? 'primary' : ''}`} onClick={() => go(t[0])}>{t[1]}</button>)}</div></div></section>
    {tab === 'overview' && <Overview />}{tab === 'logins' && <Logins />}{tab === 'jobs' && <Jobs />}{tab === 'notify' && <Notify />}{tab === 'storage' && <Storage />}{tab === 'db' && <Database />}{tab === 'traffic' && <Traffic />}
  </>;
}
