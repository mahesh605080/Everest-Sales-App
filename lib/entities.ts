export type FieldType = 'text' | 'int' | 'money' | 'float' | 'date' | 'select' | 'rel' | 'password';
export type Field = {
  key: string; label: string; type: FieldType; required?: boolean; options?: string[]; rel?: string;
  list?: boolean; virtual?: boolean; upper?: boolean; def?: any; help?: string; wide?: boolean;
};
export type Entity = { key: string; table: string; label: string; one: string; search: string[]; fields: Field[]; note?: string };

const code = (help?: string): Field => ({ key: 'code', label: 'Code', type: 'text', required: true, upper: true, list: true, help });
const name = (label = 'Name'): Field => ({ key: 'name', label, type: 'text', required: true, list: true });

export const ENT: Record<string, Entity> = {
  employees: {
    key: 'employees', table: 'users', label: 'Employees', one: 'employee', search: ['code', 'name', 'phone'],
    note: 'New employees get the default password and must change it at first login.',
    fields: [
      code('Employee code, used to log in'), name('Full name'),
      { key: 'phone', label: 'Mobile number', type: 'text', list: true, help: 'Can also be used to log in' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'role_id', label: 'Role', type: 'rel', rel: 'roles', required: true, list: true },
      { key: 'manager_id', label: 'Reports to', type: 'rel', rel: 'employees', list: true },
      { key: 'region_id', label: 'Region', type: 'rel', rel: 'regions', list: true },
      { key: 'area_id', label: 'Area', type: 'rel', rel: 'areas', list: true },
      { key: 'join_date', label: 'Joining date', type: 'date' },
      { key: 'password', label: 'Password', type: 'password', help: 'Leave empty to keep the current one. Minimum 8 characters.' },
    ],
  },
  regions: { key: 'regions', table: 'regions', label: 'Regions', one: 'region', search: ['code', 'name'], fields: [code(), name()] },
  areas: {
    key: 'areas', table: 'areas', label: 'Areas', one: 'area', search: ['code', 'name', 'hq_town'],
    fields: [code(), name(), { key: 'region_id', label: 'Region', type: 'rel', rel: 'regions', required: true, list: true },
      { key: 'hq_town', label: 'Headquarters town', type: 'text', list: true }],
  },
  categories: { key: 'categories', table: 'product_categories', label: 'Product categories', one: 'category', search: ['code', 'name'], fields: [code(), name()] },
  products: {
    key: 'products', table: 'products', label: 'Products', one: 'product', search: ['code', 'name', 'generic_name'],
    note: 'Trade rate is the base rate. Selling below it will need an approved booklet (Phase 3).',
    fields: [
      code(), name('Brand name'),
      { key: 'generic_name', label: 'Generic name', type: 'text', list: true },
      { key: 'category_id', label: 'Category', type: 'rel', rel: 'categories', required: true, list: true },
      { key: 'strength', label: 'Strength', type: 'text' },
      { key: 'pack_size', label: 'Pack size', type: 'text', list: true },
      { key: 'units_per_box', label: 'Units per box', type: 'int', required: true, list: true },
      { key: 'mrp', label: 'MRP (Rs)', type: 'money', required: true, list: true },
      { key: 'trade_rate', label: 'Trade rate (Rs)', type: 'money', required: true, list: true },
    ],
  },
  terms: {
    key: 'terms', table: 'payment_terms', label: 'Payment terms', one: 'payment term', search: ['code', 'name'],
    fields: [code(), name(), { key: 'credit_days', label: 'Credit days', type: 'int', required: true, list: true }],
  },
  customers: {
    key: 'customers', table: 'customers', label: 'Customers', one: 'customer', search: ['code', 'name', 'town', 'phone'],
    note: 'Use the same customer codes as your accounting software so that outstanding uploads match later.',
    fields: [
      code('Same code as in the accounting software'), name(),
      { key: 'type', label: 'Type', type: 'select', options: ['Distributor', 'Hospital', 'Institution', 'Retailer'], required: true, list: true },
      { key: 'town', label: 'Town', type: 'text', list: true },
      { key: 'address', label: 'Address', type: 'text', wide: true },
      { key: 'area_id', label: 'Area', type: 'rel', rel: 'areas', list: true },
      { key: 'assigned_to', label: 'Assigned to', type: 'rel', rel: 'employees', virtual: true, list: true, help: 'Changing this keeps the old assignment in history' },
      { key: 'payment_term_id', label: 'Payment term', type: 'rel', rel: 'terms', list: true },
      { key: 'credit_limit', label: 'Credit limit (Rs)', type: 'money', def: 0, list: true },
      { key: 'pan_vat', label: 'PAN / VAT number', type: 'text' },
      { key: 'dda_licence_no', label: 'DDA licence number', type: 'text' },
      { key: 'dda_expiry', label: 'DDA licence expiry', type: 'date', list: true },
      { key: 'contact_person', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'lat', label: 'Latitude', type: 'float', help: 'Example 27.0104' },
      { key: 'lng', label: 'Longitude', type: 'float', help: 'Example 84.8777' },
    ],
  },
};

export function relInfo(rel: string) {
  if (rel === 'roles') return { table: 'roles', label: 'name', code: 'key' };
  if (rel === 'employees') return { table: 'users', label: 'name', code: 'code' };
  return { table: ENT[rel].table, label: 'name', code: 'code' };
}
