'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entity, Field } from '@/lib/entities';
import { ApiError, call, rs, toast } from '@/lib/ui';

type Opt = { id: number; label: string };
const today = () => new Date().toISOString().slice(0, 10);

function Cell({ f, row }: { f: Field; row: any }) {
  const v = row[f.key];
  if (f.type === 'rel') return <>{row[f.key + '__label'] ?? <span className="code">–</span>}</>;
  if (v == null || v === '') return <span className="code">–</span>;
  if (f.type === 'money') return <span className="num">{rs(v)}</span>;
  if (f.type === 'int' || f.type === 'float') return <span className="num">{v}</span>;
  if (f.key === 'dda_expiry') {
    const days = Math.round((Date.parse(v) - Date.parse(today())) / 864e5);
    return <span className="num">{v} {days < 0 ? <span className="pill crit">Expired</span> : days <= 60 ? <span className="pill warn">{days} days left</span> : null}</span>;
  }
  if (f.type === 'date') return <span className="num">{v}</span>;
  if (f.key === 'code') return <span className="code" style={{ color: 'var(--ink)' }}>{v}</span>;
  if (f.key === 'name') return <b>{v}</b>;
  return <>{String(v)}</>;
}

export default function Master({ ent, canEdit, canImport, canExport }: { ent: Entity; canEdit: boolean; canImport: boolean; canExport: boolean }) {
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [inactive, setInactive] = useState(false);
  const [loading, setLoading] = useState(true); const [loadErr, setLoadErr] = useState('');
  const [opts, setOpts] = useState<Record<string, Opt[]>>({});
  const [form, setForm] = useState<null | { id: number | null; active: boolean; v: Record<string, any> }>(null);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState(''); const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [imp, setImp] = useState(false); const [report, setReport] = useState<any>(null); const [impErr, setImpErr] = useState(''); const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const size = 25, listFields = ent.fields.filter(f => f.list), formFields = ent.fields;

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      const r = await call(`/api/m/${ent.key}?page=${page}&size=${size}&q=${encodeURIComponent(search)}${inactive ? '&inactive=1' : ''}`);
      setRows(r.rows); setTotal(r.total);
    } catch (e: any) { setLoadErr(e.message); } finally { setLoading(false); }
  }, [ent.key, page, search, inactive]);
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [load, search]);

  const loadOpts = useCallback(async () => {
    const rels = [...new Set(ent.fields.filter(f => f.type === 'rel').map(f => f.rel!))];
    const got = await Promise.all(rels.map(r => call(`/api/m/${r}/options`).then(x => [r, x.options] as const).catch(() => [r, []] as const)));
    setOpts(Object.fromEntries(got));
  }, [ent]);
  useEffect(() => { if (canEdit) loadOpts(); }, [canEdit, loadOpts]);

  function open(row: any | null) {
    const v: Record<string, any> = {};
    for (const f of formFields) v[f.key] = f.type === 'password' ? '' : row?.[f.key] ?? '';
    setErrs({}); setFormErr(''); setConfirmOff(false);
    setForm({ id: row?.id ?? null, active: row?.active ?? true, v });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return;
    setSaving(true); setErrs({}); setFormErr('');
    try {
      await call(form.id ? `/api/m/${ent.key}/${form.id}` : `/api/m/${ent.key}`, { method: form.id ? 'PUT' : 'POST', json: form.v });
      toast(form.id ? 'Changes saved.' : `${ent.one[0].toUpperCase() + ent.one.slice(1)} added.`);
      setForm(null); load(); loadOpts();
    } catch (x: any) { setFormErr(x.message); if (x instanceof ApiError && x.fields) setErrs(x.fields); } finally { setSaving(false); }
  }
  async function toggle() {
    if (!form?.id) return;
    if (form.active && !confirmOff) { setConfirmOff(true); return; }
    setSaving(true);
    try {
      await call(`/api/m/${ent.key}/${form.id}`, { method: 'PATCH', json: { active: !form.active } });
      toast(form.active ? 'Deactivated. It stays in history but can no longer be used.' : 'Activated again.');
      setForm(null); load(); loadOpts();
    } catch (x: any) { setFormErr(x.message); } finally { setSaving(false); }
  }
  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setImpErr('Choose a file first.'); return; }
    setUploading(true); setImpErr(''); setReport(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await call(`/api/m/${ent.key}/import`, { method: 'POST', body: fd });
      setReport(r); load(); loadOpts();
    } catch (x: any) { setImpErr(x.message); } finally { setUploading(false); }
  }
  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <div className="l">
            <input id="master-search" className="search" type="text" placeholder={`Search ${ent.label.toLowerCase()}`} aria-label="Search" value={search} onChange={e => { setPage(1); setSearch(e.target.value); }} />
            <label className="chk"><input id="master-inactive" type="checkbox" checked={inactive} onChange={e => { setPage(1); setInactive(e.target.checked); }} /> Show inactive</label>
          </div>
          <div className="r">
            {canExport && <a className="btn" href={`/api/m/${ent.key}/export`}>Export</a>}
            {canImport && <button className="btn" onClick={() => { setReport(null); setImpErr(''); setImp(true); }}>Import</button>}
            {canEdit && <button className="btn primary" onClick={() => open(null)}>Add {ent.one}</button>}
          </div>
        </div>
        {loadErr && <div className="errbox" role="alert">{loadErr} <button className="btn sm" onClick={load}>Try again</button></div>}
        <div className="tbl">
          <table>
            <thead><tr>{listFields.map(f => <th key={f.key} className={['money', 'int', 'float'].includes(f.type) ? 'r' : ''}>{f.label}</th>)}<th>Status</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={canEdit ? () => open(r) : undefined} style={canEdit ? { cursor: 'pointer' } : undefined} tabIndex={canEdit ? 0 : undefined}
                  onKeyDown={canEdit ? e => { if (e.key === 'Enter') open(r); } : undefined}>
                  {listFields.map(f => <td key={f.key} className={['money', 'int', 'float'].includes(f.type) ? 'r' : ''}><Cell f={f} row={r} /></td>)}
                  <td>{r.active ? <span className="pill good">Active</span> : <span className="pill">Inactive</span>}</td>
                </tr>
              ))}
              {!rows.length && !loading && !loadErr && <tr><td colSpan={listFields.length + 1}><p className="sub" style={{ padding: '14px 0' }}>
                {search ? `Nothing matches "${search}".` : `No ${ent.label.toLowerCase()} yet. ${canEdit ? `Add the first ${ent.one} or import them from Excel.` : ''}`}</p></td></tr>}
              {loading && !rows.length && <tr><td colSpan={listFields.length + 1}><p className="sub" style={{ padding: '14px 0' }}>Loading…</p></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>{total} {total === 1 ? ent.one : ent.label.toLowerCase()}</span>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span className="num">{page} / {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </section>

      {form && (
        <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setForm(null); }}>
          <form className="modal" onSubmit={save} role="dialog" aria-modal="true" aria-label={form.id ? `Edit ${ent.one}` : `Add ${ent.one}`}>
            <div className="hd"><h2 style={{ fontSize: 17 }}>{form.id ? `Edit ${ent.one}` : `Add ${ent.one}`}</h2>{form.id && !form.active && <span className="pill">Inactive</span>}</div>
            {formErr && <div className="errbox" role="alert">{formErr}</div>}
            <div className="form">
              {formFields.map(f => {
                const id = `f-${f.key}`, val = form.v[f.key] ?? '', set = (x: any) => setForm(o => o && ({ ...o, v: { ...o.v, [f.key]: x } }));
                return (
                  <div key={f.key} className={`fld ${f.wide ? 'wide' : ''} ${errs[f.key] ? 'err' : ''}`}>
                    <label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>
                    {f.type === 'rel' ? <select id={id} value={val} onChange={e => set(e.target.value)}><option value="">{f.required ? 'Select…' : 'None'}</option>
                      {(opts[f.rel!] || []).filter(o => !(ent.key === 'employees' && f.key === 'manager_id' && o.id === form.id)).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                      : f.type === 'select' ? <select id={id} value={val} onChange={e => set(e.target.value)}><option value="">Select…</option>{f.options!.map(o => <option key={o}>{o}</option>)}</select>
                        : <input id={id} value={val} onChange={e => set(e.target.value)} autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                          type={f.type === 'password' ? 'password' : f.type === 'date' ? 'date' : ['int', 'money', 'float'].includes(f.type) ? 'number' : 'text'}
                          step={f.type === 'money' ? '0.01' : f.type === 'float' ? 'any' : undefined} min={f.type === 'int' || f.type === 'money' ? 0 : undefined} />}
                    {errs[f.key] ? <span className="e">{errs[f.key]}</span> : f.help ? <small>{f.type === 'password' && !form.id ? 'Leave empty to use the default password. Minimum 8 characters.' : f.help}</small> : null}
                  </div>
                );
              })}
            </div>
            <div className="toolbar">
              <div className="l">{form.id && <button type="button" className={`btn ${form.active ? 'danger' : ''}`} disabled={saving} onClick={toggle}>{form.active ? (confirmOff ? 'Confirm deactivate' : 'Deactivate') : 'Activate'}</button>}
                {confirmOff && <span className="sub">It stays in history but can no longer be selected.</span>}</div>
              <div className="r"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
            </div>
          </form>
        </div>
      )}

      {imp && (
        <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setImp(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Import ${ent.label}`}>
            <h2 style={{ fontSize: 17 }}>Import {ent.label.toLowerCase()}</h2>
            <p className="sub">Upload an .xlsx or .csv file. Rows are matched on Code: an existing code is updated, a new code is added. Linked columns (for example "Region code") use the code of the linked record.</p>
            <div className="toolbar"><div className="l"><input id="import-file" ref={fileRef} type="file" accept=".xlsx,.csv" /></div>
              <div className="r"><a className="btn" href={`/api/m/${ent.key}/export?template=1`}>Download template</a><button className="btn primary" disabled={uploading} onClick={upload}>{uploading ? 'Importing…' : 'Upload'}</button></div></div>
            {impErr && <div className="errbox" role="alert">{impErr}</div>}
            {report && <>
              <div className={report.failed ? 'banner' : 'okbox'}>{report.created} added, {report.updated} updated, {report.unchanged} unchanged, {report.failed} skipped.</div>
              {report.errors.length > 0 && <div className="tbl" style={{ maxHeight: 260, overflowY: 'auto' }}><table><thead><tr><th>Row</th><th>Why it was skipped</th></tr></thead>
                <tbody>{report.errors.map((x: any, i: number) => <tr key={i}><td className="num">{x.row}</td><td>{x.message}</td></tr>)}</tbody></table></div>}
            </>}
            <div className="toolbar"><div className="l" /><div className="r"><button className="btn" onClick={() => setImp(false)}>Close</button></div></div>
          </div>
        </div>
      )}
    </>
  );
}
