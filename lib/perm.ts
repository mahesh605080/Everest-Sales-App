import { ENT } from './entities';

export const PERM_GROUPS: { group: string; perms: { key: string; label: string }[] }[] = [
  ...Object.values(ENT).map(e => ({ group: e.label, perms: [{ key: `${e.key}.view`, label: 'View' }, { key: `${e.key}.edit`, label: 'Add and edit' }] })),
  { group: 'Data transfer', perms: [{ key: 'import.run', label: 'Import from Excel' }, { key: 'export.run', label: 'Export to Excel' }] },
  { group: 'Map and location', perms: [{ key: 'map.view', label: 'View customer map' }, { key: 'track.view', label: 'See team location' }, { key: 'track.send', label: 'Share own location' }] },
  { group: 'Administration', perms: [{ key: 'roles.manage', label: 'Roles and permissions' }, { key: 'settings.manage', label: 'Settings' }, { key: 'audit.view', label: 'Audit log' }] },
];
export const ALL_PERMS = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key));

export type Session = {
  id: number; code: string; name: string; phone: string | null; email: string | null; region_id: number | null; area_id: number | null;
  must_change_password: boolean; role: string; role_name: string; level: number; permissions: string[];
};
export const can = (s: Session | null, p: string) => !!s && Array.isArray(s.permissions) && s.permissions.includes(p);
