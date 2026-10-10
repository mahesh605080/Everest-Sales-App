import { ENT } from './entities';

export const PERM_GROUPS: { group: string; perms: { key: string; label: string }[] }[] = [
  ...Object.values(ENT).map(e => ({ group: e.label, perms: [{ key: `${e.key}.view`, label: 'View' }, { key: `${e.key}.edit`, label: 'Add and edit' }] })),
  { group: 'Data transfer', perms: [{ key: 'import.run', label: 'Import from Excel' }, { key: 'export.run', label: 'Export to Excel' }] },
  { group: 'Map and location', perms: [{ key: 'map.view', label: 'View customer map' }, { key: 'track.view', label: 'See team location' }, { key: 'track.send', label: 'Share own location' }] },
  { group: 'Field work', perms: [{ key: 'field.use', label: 'Customer visits (own)' }, { key: 'team.view', label: 'Team visits' }, { key: 'alerts.view', label: 'See and acknowledge alerts' }, { key: 'alerts.manage', label: 'Change alert rules' }, { key: 'plan.use', label: 'Make own tour plan' }, { key: 'plan.approve', label: 'Approve team tour plans' }, { key: 'notices.manage', label: 'Publish notices' }] },
  { group: 'Sales and credit', perms: [{ key: 'booklets.create', label: 'Create booklets' }, { key: 'booklets.approve', label: 'Approve booklets at own level' }, { key: 'orders.create', label: 'Create sales orders' }, { key: 'sales.view', label: 'See team booklets and orders' }, { key: 'credit.manage', label: 'Credit control: approve orders, limits, instruments, outstanding upload' }, { key: 'dispatch.manage', label: 'Mark orders dispatched' }] },
  { group: 'Collections and claims', perms: [{ key: 'collections.create', label: 'Record collections' }, { key: 'collections.verify', label: 'Verify collections' }, { key: 'claims.create', label: 'Raise claims' }, { key: 'claims.approve', label: 'Approve claims' }, { key: 'claims.settle', label: 'Settle claims' }] },
  { group: 'Market', perms: [{ key: 'samples.create', label: 'Record samples and gifts' }, { key: 'samples.view', label: 'See team samples and gifts' }, { key: 'competitor.create', label: 'Record competitor information' }, { key: 'competitor.view', label: 'See team competitor information' }] },
  { group: 'Company stock and expiry', perms: [{ key: 'inventory.view', label: 'See batch stock, expiry risk and near-expiry offers' }, { key: 'inventory.manage', label: 'Upload stock and set near-expiry offer slabs' }] },
  { group: 'Yearly rebate', perms: [{ key: 'rebate.view', label: 'See distributor rebate position' }, { key: 'rebate.manage', label: 'Set rebate slabs' }] },
  { group: 'Distributor stock', perms: [{ key: 'stock.report', label: 'Report distributor stock' }, { key: 'stock.view', label: 'See stock reports' }] },
  { group: 'Performance', perms: [{ key: 'targets.manage', label: 'Set monthly targets' }, { key: 'scorecard.view', label: 'Control room and scorecard' }, { key: 'reports.run', label: 'Download reports' }] },
  { group: 'Platform', perms: [{ key: 'data.manage', label: 'Read and change every document in the document store' }, { key: 'chat.use', label: 'Chat with colleagues' }] },
  { group: 'Administration', perms: [{ key: 'roles.manage', label: 'Roles and permissions' }, { key: 'settings.manage', label: 'Settings' }, { key: 'audit.view', label: 'Audit log' }] },
];
export const ALL_PERMS = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key));

export type Session = {
  id: number; code: string; name: string; phone: string | null; email: string | null; region_id: number | null; area_id: number | null;
  must_change_password: boolean; role: string; role_name: string; level: number; permissions: string[];
};
export const can = (s: Session | null, p: string) => !!s && Array.isArray(s.permissions) && s.permissions.includes(p);
