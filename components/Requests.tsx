'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ReqDef, RField } from '@/lib/reqdefs';
import { call, rs, toast } from '@/lib/ui';
import { nptToday } from '@/lib/geo';
import { ST, when } from './SalesBits';
import FilterBar, { Filter, filterQuery, noFilter } from './FilterBar';

/** Shrinks a camera photo and uploads it; gives back the stored photo's id. */
export function PhotoInput({ id, value, onChange }: { id: string; value: number | null; onChange: (id: number | null) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return; setErr(''); setBusy(true);
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = async () => {
      const k = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      try { onChange((await call('/api/photo', { method: 'POST', json: { photo: c.toDataURL('image/jpeg', 0.72) } })).id); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
    };
    img.onerror = () => { setErr('That file is not a photo.'); setBusy(false); URL.revokeObjectURL(url); };
    img.src = url;
  }
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><input id={id} type="file" accept="image/*" capture="environment" onChange={pick} />
    {busy && <span className="sub">Uploading…</span>}{value && <a href={`/api/photo/${value}`} target="_blank" rel="noreferrer"><img src={`/api/photo/${value}`} alt="Attached photo" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} /></a>}
    {err && <span className="e" style={{ color: 'var(--crit)', fontSize: 12 }}>{err}</span>}</div>;
}

const LABELS: Record<string, string> = { item: 'Item',  km_gps: 'GPS distance (km)', ta: 'Travel allowance (Rs)', product: 'Product', days: 'Days' };
function fmt(def: ReqDef, k: string, v: any) {
  if (v == null || v === '') return null;
  const f = def.fields.find(x => x.key === k);
  if (f?.type === 'money') return Number(v) ? rs(v) : null;
  return String(v);
}

function NewForm({ def, onDone }: { def: ReqDef; onDone: () => void }) {
  const [v, setV] = useState<Record<string, any>>(() => Object.fromEntries(def.fields.map(f => [f.key, f.key === 'day' ? nptToday() : ''])));
  const [custs, setCusts] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (def.fields.some(f => f.type === 'customer')) call('/api/m/customers?size=500').then(r => setCusts(r.rows)).catch(e => setErr(e.message));
    if (def.fields.some(f => f.type === 'product')) call('/api/m/products?size=500').then(r => setProds(r.rows)).catch(() => {});
  }, [def]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await call(`/api/req/${def.key}`, { method: 'POST', json: v }); toast(`${def.one[0].toUpperCase() + def.one.slice(1)} ${def.steps.length ? 'submitted' : 'saved'}.`); onDone(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  const input = (f: RField) => { const id = `rq-${f.key}`, set = (x: any) => setV(o => ({ ...o, [f.key]: x }));
    if (f.type === 'customer') return <select id={id} value={v[f.key]} onChange={e => set(e.target.value)}><option value="">Select…</option>{custs.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select>;
    if (f.type === 'product') return <select id={id} value={v[f.key]} onChange={e => set(e.target.value)}><option value="">None</option>{prods.map(p => <option key={p.id} value={p.id}>{p.name} {p.pack_size || ''} ({p.code})</option>)}</select>;
    if (f.type === 'select') return <select id={id} value={v[f.key]} onChange={e => set(e.target.value)}><option value="">Select…</option>{f.options!.map(o => <option key={o}>{o}</option>)}</select>;
    if (f.type === 'photo') return <PhotoInput id={id} value={v[f.key] || null} onChange={set} />;
    return <input id={id} value={v[f.key]} onChange={e => set(e.target.value)} type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'} min={f.type === 'text' || f.type === 'date' ? undefined : 0} step={f.type === 'money' ? '0.01' : undefined} max={f.type === 'date' && f.key === 'day' ? nptToday() : undefined} />; };
  return <form className="card" onSubmit={submit}><h2>New {def.one}</h2>
    <div className="form">{def.fields.map(f => <div key={f.key} className={`fld ${f.wide || f.type === 'photo' ? 'wide' : ''}`}><label htmlFor={`rq-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>{input(f)}{f.help && <small>{f.help}</small>}</div>)}</div>
    {err && <div className="errbox" role="alert">{err}</div>}
    <div className="toolbar"><div className="l"><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Submit'}</button><button type="button" className="btn" onClick={onDone}>Discard</button></div></div></form>;
}

export default function Requests({ def, canCreate, canDecide, hasInbox = true }: { def: ReqDef; canCreate: boolean; canDecide: boolean; hasInbox?: boolean }) {
  const boxes = [canDecide && hasInbox && ['inbox', 'Waiting for me'], canCreate && ['mine', 'Mine'], canDecide && ['all', hasInbox ? 'All' : 'Team']].filter(Boolean) as string[][];
  const [box, setBox] = useState(boxes[0][0]); const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [adding, setAdding] = useState(false); const [rm, setRm] = useState<Record<number, string>>({}); const [flt, setFlt] = useState<Filter>(noFilter);
  const statuses = hasInbox ? [...new Set(['Submitted', ...def.steps.map(st => st.to), 'Rejected', 'Withdrawn'])] : [];
  const load = useCallback(() => call(`/api/req/${def.key}?box=${box}${filterQuery(flt)}`).then(r => { setRows(r.rows); setErr(''); }).catch(e => setErr(e.message)), [def.key, box, flt]);
  useEffect(() => { setRows(null); load(); }, [load]);
  async function act(id: number, action: string) { setErr(''); try { const r = await call(`/api/req/${def.key}/${id}`, { method: 'POST', json: { action, remarks: rm[id] || '' } }); toast(r.message); load(); } catch (e: any) { setErr(e.message); } }
  const amount = (r: any) => r.amount;
  return <>
    <section className="card"><div className="toolbar"><div className="l">{boxes.map(b => <button key={b[0]} className={`btn ${box === b[0] ? 'primary' : ''}`} onClick={() => { setBox(b[0]); setFlt(noFilter); }}>{b[1]}</button>)}</div>
      <div className="r">{canCreate && !adding && <button className="btn primary" onClick={() => setAdding(true)}>New {def.one}</button>}</div></div>
      {box !== 'inbox' && <FilterBar id={`rq-${def.key}`} statuses={statuses} value={flt} onChange={setFlt} hint="Search person or customer" />}</section>
    {adding && <NewForm def={def} onDone={() => { setAdding(false); if (canCreate) setBox('mine'); load(); }} />}
    {err && <div className="errbox" role="alert">{err}</div>}
    {(rows || []).map(r => <section className="card" key={r.id}>
      <div className="hd"><div><h2>{r.customer || r.person}</h2><span className="code">{r.customer ? `${r.person} · ` : ''}{r.day}{r.area ? ` · ${r.area}` : ''}</span></div>
        <div className="toolbar">
          {r.status !== 'Recorded' && <span className={`pill ${ST[r.status] || (r.status === 'Submitted' ? 'warn' : ['Verified', 'Settled'].includes(r.status) ? 'info' : '')}`}>{r.status}</span>}{amount(r) != null && <b className="num">{rs(amount(r))}</b>}</div></div>
      <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>{def.show.map(k => { const val = fmt(def, k, r[k]); return val == null ? null : <div key={k}><div className="lab">{def.fields.find(f => f.key === k)?.label || LABELS[k] || k}</div><span className={/^[\d.]+$|^Rs /.test(val) ? 'num' : undefined}>{val}</span></div>; })}
        {r.photo_id && <div><div className="lab">Photo</div><a href={`/api/photo/${r.photo_id}`} target="_blank" rel="noreferrer"><img src={`/api/photo/${r.photo_id}`} alt="Attached proof" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} /></a></div>}</div>
      {r.remarks && <p className="sub">{r.remarks}</p>}
      {r.next && <div className="toolbar"><div className="l" style={{ flex: 1 }}><input type="text" id={`rq-rm-${r.id}`} aria-label="Remarks" placeholder="Remarks (needed to reject)" value={rm[r.id] || ''} onChange={e => setRm(o => ({ ...o, [r.id]: e.target.value }))} style={{ flex: 1, minWidth: 180 }} /></div>
        <div className="r"><button className="btn primary" onClick={() => act(r.id, 'next')}>{r.next}</button><button className="btn danger" onClick={() => act(r.id, 'reject')}>Reject</button></div></div>}
      {box === 'mine' && r.status === 'Submitted' && hasInbox && <div><button className="btn sm" onClick={() => act(r.id, 'withdraw')}>Withdraw</button></div>}
      <div className="sub">{r.trail.map((t: any, i: number) => <span key={i}>{i ? ' → ' : ''}{t.action} by {t.user_name}, {when(t.at)}{t.remarks ? ` (“${t.remarks}”)` : ''}</span>)}</div>
    </section>)}
    {rows && !rows.length && <section className="card"><p className="sub">{box === 'inbox' ? 'Nothing is waiting for you.' : `No ${def.label.toLowerCase()} here yet.`}</p></section>}
  </>;
}
