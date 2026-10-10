'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/ui';
import { deleteFile, downloadUrl, fileLink, fileSize, listFiles, shareFile, StoredFile, uploadFile } from '@/lib/files';

export default function Files({ canAll }: { canAll: boolean }) {
  const scopes = [['mine', 'My files'], ['shared', 'Shared with me'], canAll && ['all', 'Everyone\'s']].filter(Boolean) as string[][];
  const [scope, setScope] = useState('mine'); const [d, setD] = useState<Awaited<ReturnType<typeof listFiles>> | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const load = useCallback(() => listFiles(scope as any).then(r => { setD(r); setErr(''); }).catch(e => setErr(e.message)), [scope]);
  useEffect(() => { setD(null); load(); }, [load]);
  async function add(list: FileList | null) {
    if (!list?.length) return; setBusy(true); setErr('');
    try { for (const f of Array.from(list)) await uploadFile(f); toast(list.length === 1 ? 'File saved.' : `${list.length} files saved.`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); if (pick.current) pick.current.value = ''; load(); }
  }
  async function act(fn: () => Promise<any>, done: string) { setErr(''); try { await fn(); toast(done); load(); } catch (e: any) { setErr(e.message); } }
  const q = d?.quota, pct = q ? Math.min(100, q.used_bytes / Math.max(1, q.limit_bytes) * 100) : 0;
  return <>
    <section className="card"><div className="toolbar"><div className="l">{scopes.map(s => <button key={s[0]} className={`btn ${scope === s[0] ? 'primary' : ''}`} onClick={() => setScope(s[0])}>{s[1]}</button>)}</div>
      <div className="r"><input ref={pick} id="file-pick" type="file" multiple hidden onChange={e => add(e.target.files)} accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.xlsx,.docx,.pptx,.csv,.txt" />
        <button className="btn primary" disabled={busy} onClick={() => pick.current?.click()}>{busy ? 'Saving…' : 'Add files'}</button></div></div>
      {q && <div><div className="hd"><span className="sub">{fileSize(q.used_bytes)} of {fileSize(q.limit_bytes)} used · {q.files} files</span></div>
        <div style={{ height: 8, background: 'var(--sunk)', borderRadius: 4 }}><div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: pct > 90 ? 'var(--crit-fill)' : 'var(--accent2)' }} /></div></div>}
      <p className="sub">Photos, PDF, Excel, Word, PowerPoint, CSV and text, up to 10 MB each. A file is private until you share it.</p>
      {err && <div className="errbox" role="alert">{err}</div>}</section>
    {link && <section className="card"><div className="hd"><h2>Link for one hour</h2><button className="btn sm" onClick={() => setLink(null)}>Close</button></div>
      <p className="sub">Anyone with this link can download the file for the next hour, without logging in.</p>
      <input type="text" readOnly aria-label="Download link" value={link.url} onFocus={e => e.currentTarget.select()} />
      <div><button className="btn sm primary" onClick={() => navigator.clipboard.writeText(link.url).then(() => toast('Link copied.')).catch(() => {})}>Copy link</button></div></section>}
    <section className="card">
      {!d ? <p className="sub">Loading…</p> : !d.files.length ? <p className="sub">{scope === 'mine' ? 'No files yet. Add one with "Add files".' : 'Nothing here.'}</p> :
        <div className="tbl"><table><thead><tr><th>File</th><th className="r">Size</th><th>Added</th><th /></tr></thead>
          <tbody>{d.files.map((f: StoredFile) => <tr key={f.id}><td><a href={downloadUrl(f.id, true)} target="_blank" rel="noreferrer"><b>{f.name}</b></a><br /><span className="code">{f.folder || 'no folder'} · {f.content_type.split('/').pop()}</span></td>
            <td className="r num">{fileSize(f.size)}</td><td className="num">{new Date(f.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            <td style={{ whiteSpace: 'nowrap' }}><a className="btn sm" href={downloadUrl(f.id)}>Download</a> <button className="btn sm" onClick={async () => { try { setLink({ id: f.id, url: await fileLink(f.id) }); } catch (e: any) { setErr(e.message); } }}>Get link</button>
              {f.mine && <> <button className="btn sm" onClick={() => act(() => shareFile(f.id, { everyone: true }), 'Everyone in the company can now open it.')}>Share with all</button> <button className="btn sm" onClick={() => act(() => shareFile(f.id, {}), 'Private again.')}>Make private</button> <button className="btn sm danger" onClick={() => act(() => deleteFile(f.id), 'File deleted.')}>Delete</button></>}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
