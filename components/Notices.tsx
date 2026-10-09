'use client';
import { useCallback, useEffect, useState } from 'react';
import { call, toast } from '@/lib/ui';

export default function Notices({ roles, regions }: { roles: { key: string; name: string }[]; regions: { id: number; name: string }[] }) {
  const [d, setD] = useState<{ notices: any[]; manage: boolean } | null>(null); const [err, setErr] = useState('');
  const [f, setF] = useState({ title: '', body: '', category: 'General', role_key: '', region_id: '', expires: '' }); const [busy, setBusy] = useState(false);
  const load = useCallback(() => call('/api/notices').then(setD).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  async function read(id: number) { await call('/api/notices/read', { method: 'POST', json: { id } }).catch(() => {}); load(); }
  async function publish(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await call('/api/notices', { method: 'POST', json: f }); toast('Notice published.'); setF({ title: '', body: '', category: 'General', role_key: '', region_id: '', expires: '' }); load(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <>
      {err && <div className="errbox" role="alert">{err}</div>}
      {d?.manage && <form className="card" onSubmit={publish}><h2>New notice</h2>
        <div className="form">
          <div className="fld wide"><label htmlFor="n-title">Title *</label><input id="n-title" type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
          <div className="fld wide"><label htmlFor="n-body">Message *</label><textarea id="n-body" rows={3} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} style={{ font: 'inherit', border: '1px solid var(--line2)', borderRadius: 8, padding: '7px 10px', resize: 'vertical' }} /></div>
          <div className="fld"><label htmlFor="n-cat">Category</label><select id="n-cat" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{['General', 'Price change', 'New product', 'Scheme', 'Operations', 'HR'].map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="fld"><label htmlFor="n-exp">Show until</label><input id="n-exp" type="date" value={f.expires} onChange={e => setF({ ...f, expires: e.target.value })} /><small>Empty = no end date</small></div>
          <div className="fld"><label htmlFor="n-role">Only for role</label><select id="n-role" value={f.role_key} onChange={e => setF({ ...f, role_key: e.target.value })}><option value="">Everyone</option>{roles.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}</select></div>
          <div className="fld"><label htmlFor="n-reg">Only for region</label><select id="n-reg" value={f.region_id} onChange={e => setF({ ...f, region_id: e.target.value })}><option value="">All regions</option>{regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        </div>
        <div><button className="btn primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button></div></form>}
      {(d?.notices || []).map(n => <section className="card" key={n.id}>
        <div className="hd"><div><h2>{n.title}</h2><span className="code">{new Date(n.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kathmandu' })} · {n.by || 'Head office'}{n.role_name ? ` · for ${n.role_name}` : ''}{n.region ? ` · ${n.region}` : ''}{n.expires ? ` · until ${n.expires}` : ''}</span></div>
          <div className="toolbar"><span className="pill">{n.category}</span>{d?.manage && <span className="pill info">{n.reads} read</span>}{!n.read && <span className="pill warn">Unread</span>}</div></div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
        {!n.read && <div><button className="btn sm" onClick={() => read(n.id)}>Mark as read</button></div>}</section>)}
      {d && !d.notices.length && <section className="card"><p className="sub">No notices right now.</p></section>}
    </>
  );
}
