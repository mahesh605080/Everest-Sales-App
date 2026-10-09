import { ENT } from './entities';

export const PERM_GROUPS: { group: string; perms: { key: string; label: string }[] }[] = [
  ...Object.values(ENT).map(e => ({ group: e.label, perms: [{ key: `${e.key}.view`, label: 'View' }, { key: `${e.key}.edit`, label: 'Add and edit' }] })),
  { group: 'Data transfer', perms: [{ key: 'import.run', label: 'Import from Excel' }, { key: 'export.run', label: 'Export to Excel' }] },
  { group: 'Map and location', perms: [{ key: 'map.view', label: 'View customer map' }, { key: 'track.view', label: 'See team location' }, { key: 'track.send', label: 'Share own location' }] },
  { group: 'Field work', perms: [{ key: 'field.use', label: 'Attendance and visits (own)' }, { key: 'team.view', label: 'Team attendance and visits' }, { key: 'alerts.view', label: 'See and acknowledge alerts' }, { key: 'alerts.manage', label: 'Change alert rules' }, { key: 'plan.use', label: 'Make own tour plan' }, { key: 'plan.approve', label: 'Approve team tour plans' }, { key: 'notices.manage', label: 'Publish notices' }] },
  { group: 'Sales and credit', perms: [{ key: 'booklets.create', label: 'Create booklets' }, { key: 'booklets.approve', label: 'Approve booklets at own level' }, { key: 'orders.create', label: 'Create sales orders' }, { key: 'sales.view', label: 'See team booklets and orders' }, { key: 'credit.manage', label: 'Credit control: approve orders, limits, instruments, outstanding upload' }, { key: 'dispatch.manage', label: 'Mark orders dispatched' }] },
  { group: 'Collections, expenses, claims, leave', perms: [{ key: 'collections.create', label: 'Record collections' }, { key: 'collections.verify', label: 'Verify collections' }, { key: 'expenses.create', label: 'Claim expenses' }, { key: 'expenses.approve', label: 'Approve team expenses' }, { key: 'expenses.pay', label: 'Mark expenses paid' },
    { key: 'claims.create', label: 'Raise claims' }, { key: 'claims.approve', label: 'Approve claims' }, { key: 'claims.settle', label: 'Settle claims' }, { key: 'leave.apply', label: 'Apply for leave' }, { key: 'leave.approve', label: 'Approve team leave' }] },
  { group: 'Distributor stock', perms: [{ key: 'stock.report', label: 'Report distributor stock' }, { key: 'stock.view', label: 'See stock reports' }] },
  { group: 'Administration', perms: [{ key: 'roles.manage', label: 'Roles and permissions' }, { key: 'settings.manage', label: 'Settings' }, { key: 'audit.view', label: 'Audit log' }] },
];
export const ALL_PERMS = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key));

export type Session = {
  id: number; code: string; name: string; phone: string | null; email: string | null; region_id: number | null; area_id: number | null;
  must_change_password: boolean; role: string; role_name: string; level: number; permissions: string[];
};
export const can = (s: Session | null, p: string) => !!s && Array.isArray(s.permissions) && s.permissions.includes(p);
