/** The four "request" documents share one engine: a field user creates it, someone decides, sometimes someone closes it. */
export type RField = { key: string; label: string; type: 'text' | 'money' | 'int' | 'km' | 'date' | 'select' | 'customer' | 'product' | 'photo'; required?: boolean; options?: string[]; help?: string; wide?: boolean };
export type Step = { from: string; to: string; perm: string; label: string; scope: 'team' | 'all'; done: string };
export type ReqDef = { key: string; table: string; label: string; one: string; create: string; intro: string; fields: RField[]; steps: Step[]; show: string[] };

export const REQ: Record<string, ReqDef> = {
  collections: {
    key: 'collections', table: 'collections', label: 'Collections', one: 'collection', create: 'collections.create',
    intro: 'Record every payment received from a customer. Credit Control verifies it against the bank or cash book.',
    fields: [
      { key: 'customer_id', label: 'Customer', type: 'customer', required: true },
      { key: 'mode', label: 'Mode', type: 'select', options: ['Cash', 'Cheque', 'Bank transfer', 'Online'], required: true },
      { key: 'amount', label: 'Amount (Rs)', type: 'money', required: true },
      { key: 'ref_no', label: 'Cheque / reference number', type: 'text', help: 'Needed for a cheque' },
      { key: 'bank', label: 'Bank', type: 'text' },
      { key: 'cheque_date', label: 'Cheque date', type: 'date', help: 'Needed for a cheque' },
      { key: 'photo_id', label: 'Photo of cheque or receipt', type: 'photo' },
      { key: 'remarks', label: 'Remarks', type: 'text', wide: true },
    ],
    steps: [{ from: 'Submitted', to: 'Verified', perm: 'collections.verify', label: 'Verify', scope: 'all', done: 'Collection verified.' }],
    show: ['mode', 'ref_no', 'bank', 'cheque_date'],
  },
  expenses: {
    key: 'expenses', table: 'expenses', label: 'Expenses', one: 'expense claim', create: 'expenses.create',
    intro: 'One claim per working day. Travel allowance is km × the rate in Settings, and the km is compared with your GPS distance for that day.',
    fields: [
      { key: 'day', label: 'Date of travel', type: 'date', required: true },
      { key: 'route', label: 'Route', type: 'text', required: true, help: 'For example Birgunj – Kalaiya – Birgunj' },
      { key: 'km_claimed', label: 'Distance (km)', type: 'km', required: true },
      { key: 'da', label: 'Daily allowance (Rs)', type: 'money' },
      { key: 'lodging', label: 'Lodging (Rs)', type: 'money' },
      { key: 'other', label: 'Other (Rs)', type: 'money' },
      { key: 'other_note', label: 'What the other amount is for', type: 'text' },
      { key: 'photo_id', label: 'Photo of bills', type: 'photo' },
      { key: 'remarks', label: 'Remarks', type: 'text', wide: true },
    ],
    steps: [{ from: 'Submitted', to: 'Approved', perm: 'expenses.approve', label: 'Approve', scope: 'team', done: 'Expense claim approved.' },
      { from: 'Approved', to: 'Paid', perm: 'expenses.pay', label: 'Mark paid', scope: 'all', done: 'Marked as paid.' }],
    show: ['route', 'km_claimed', 'km_gps', 'ta', 'da', 'lodging', 'other', 'other_note'],
  },
  claims: {
    key: 'claims', table: 'claims', label: 'Claims', one: 'claim', create: 'claims.create',
    intro: 'Expired or near-expiry returns, breakage and rate-difference claims raised for a customer.',
    fields: [
      { key: 'customer_id', label: 'Customer', type: 'customer', required: true },
      { key: 'type', label: 'Claim type', type: 'select', options: ['Expired stock', 'Near expiry', 'Breakage', 'Rate difference', 'Other'], required: true },
      { key: 'product_id', label: 'Product', type: 'product' },
      { key: 'qty', label: 'Quantity (boxes)', type: 'int' },
      { key: 'batch_no', label: 'Batch number', type: 'text' },
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'amount', label: 'Claim amount (Rs)', type: 'money', required: true },
      { key: 'photo_id', label: 'Photo of the stock', type: 'photo' },
      { key: 'remarks', label: 'Remarks', type: 'text', required: true, wide: true },
    ],
    steps: [{ from: 'Submitted', to: 'Approved', perm: 'claims.approve', label: 'Approve', scope: 'team', done: 'Claim approved.' },
      { from: 'Approved', to: 'Settled', perm: 'claims.settle', label: 'Mark settled', scope: 'all', done: 'Claim settled.' }],
    show: ['type', 'product', 'qty', 'batch_no', 'expiry_date'],
  },
  leave: {
    key: 'leave', table: 'leaves', label: 'Leave', one: 'leave request', create: 'leave.apply',
    intro: 'Approved leave removes the "no check-in" alert for those days and shows the person as on leave in Team today.',
    fields: [
      { key: 'from_date', label: 'From', type: 'date', required: true },
      { key: 'to_date', label: 'To', type: 'date', required: true },
      { key: 'type', label: 'Leave type', type: 'select', options: ['Casual', 'Sick', 'Annual', 'Unpaid', 'Other'], required: true },
      { key: 'remarks', label: 'Reason', type: 'text', required: true, wide: true },
    ],
    steps: [{ from: 'Submitted', to: 'Approved', perm: 'leave.approve', label: 'Approve', scope: 'team', done: 'Leave approved.' }],
    show: ['type', 'from_date', 'to_date', 'days'],
  },
};
