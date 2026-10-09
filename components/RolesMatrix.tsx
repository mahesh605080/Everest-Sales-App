'use client';
import { useState } from 'react';
import { call, toast } from '@/lib/ui';

export default function RolesMatrix({ roles: initial, groups }: { roles: any[]; groups: { group: string; perms: { key: string; label: string }[] }[] }) {
  const [roles, setRoles] = useState(initial); const [busy, setBusy] = useState('');
  async function flip(role: any, perm: string, on: boolean) {
    const next = on ? [...role.permissions, perm] : role.permissions.filter((p: string) => p !== perm);
    setBusy(role.key + perm);
    try {
      await call('/api/roles', { method: 'PUT', json: { id: role.id, permissions: next } });
      setRoles(rs => rs.map(r => r.id === role.id ? { ...r, permissions: next } : r));
      toast(`${role.name}: ${on ? 'allowed' : 'removed'}. Applies from their next page load.`);
    } catch (e: any) { toast(e.message); } finally { setBusy(''); }
  }
  return (
    <section className="card">
      <p className="sub">Tick what each role may do. Changes are saved at once and written to the audit log. Territory limits are separate: a Sales Officer always sees only assigned customers, an ASM the area, an RSM the region.</p>
      <div className="tbl"><table className="matrix">
        <thead><tr><th>Permission</th>{roles.map(r => <th key={r.id} className="c">{r.name}</th>)}</tr></thead>
        <tbody>{groups.map(g => [<tr className="g" key={g.group}><td colSpan={roles.length + 1}>{g.group}</td></tr>,
          ...g.perms.map(p => <tr key={p.key}><td>{p.label}</td>{roles.map(r => <td key={r.id} className="c">
            <input type="checkbox" id={`p-${r.key}-${p.key}`} aria-label={`${r.name}: ${g.group}, ${p.label}`} checked={r.permissions.includes(p.key)}
              disabled={r.key === 'admin' || busy === r.key + p.key} onChange={e => flip(r, p.key, e.target.checked)} /></td>)}</tr>)])}</tbody>
      </table></div>
      <p className="sub">Admin always keeps every permission, so the system cannot be locked out.</p>
    </section>
  );
}
