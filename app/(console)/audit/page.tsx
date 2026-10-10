import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { q, q1 } from '@/lib/db';
import { can } from '@/lib/perm';

const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'failed_logins', 'locked_until', 'last_login_at']);
function diff(b: any, a: any): string {
  if (!b && !a) return '';
  if (!b) return 'created';
  const keys = Object.keys({ ...b, ...a }).filter(k => !SKIP.has(k) && JSON.stringify(b?.[k] ?? null) !== JSON.stringify(a?.[k] ?? null));
  return keys.slice(0, 5).map(k => `${k}: ${b?.[k] ?? '–'} → ${a?.[k] ?? '–'}`).join(' · ') + (keys.length > 5 ? ` · +${keys.length - 5} more` : '');
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const s = await getSession();
  if (!can(s, 'audit.view')) return <section className="card"><h2>No access</h2><p className="sub">Your role does not include the audit log.</p></section>;
  const sp = await searchParams, page = Math.max(1, Number(sp.page) || 1), size = 50, find = String(sp.q || '').trim().slice(0, 60);
  // The search text is only ever a parameter; it never becomes part of the SQL.
  const where = find ? `where user_name ilike $1 or action ilike $1 or entity ilike $1 or entity_id = $2 or ip = $2` : '', args = find ? [`%${find.replace(/[%_\\]/g, m => '\\' + m)}%`, find] : [];
  const total = (await q1<any>(`select count(*)::int n from audit_logs ${where}`, args))!.n;
  const rows = await q<any>(`select * from audit_logs ${where} order by at desc limit $${args.length + 1} offset $${args.length + 2}`, [...args, size, (page - 1) * size]);
  const link = (p: number) => `/audit?page=${p}${find ? `&q=${encodeURIComponent(find)}` : ''}`;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <section className="card">
      <form className="toolbar" action="/audit" method="get"><div className="l"><input type="text" name="q" defaultValue={find} placeholder="Search by person, action, record or IP" aria-label="Search the audit log" style={{ minWidth: 280 }} /><button className="btn primary">Search</button>{find && <Link className="btn" href="/audit">Clear</Link>}</div></form>
      <div className="tbl"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Where</th><th>What changed</th><th>IP</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td className="num" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' })}</td>
          <td><b>{r.user_name || 'System'}</b></td><td><span className={`pill ${r.action === 'lockout' || r.action === 'deactivate' ? 'crit' : r.action === 'create' ? 'good' : 'info'}`}>{r.action}</span></td>
          <td>{r.entity}{r.entity_id ? <span className="code"> #{r.entity_id}</span> : null}</td><td style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{diff(r.before, r.after)}</td><td className="code">{r.ip || '–'}</td></tr>)}
          {!rows.length && <tr><td colSpan={6}><p className="sub">{find ? 'Nothing matches.' : 'Nothing has been logged yet.'}</p></td></tr>}</tbody></table></div>
      <div className="pager"><span>{total} entries</span>{page > 1 && <Link className="btn sm" href={link(page - 1)}>Previous</Link>}<span className="num">{page} / {pages}</span>{page < pages && <Link className="btn sm" href={link(page + 1)}>Next</Link>}</div>
    </section>
  );
}
