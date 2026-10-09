/** These documents share one engine: a field user creates it, someone decides, sometimes someone closes it. */
export type RField = { key: string; label: string; type: 'text' | 'money' | 'int' | 'date' | 'select' | 'customer' | 'product' | 'photo'; required?: boolean; options?: string[]; help?: string; wide?: boolean };
export type Step = { from: string; to: string; perm: string; label: string; scope: 'team' | 'all'; done: string };
export type ReqDef = { key: string; table: string; label: string; one: string; create: string; view?: string; intro: string; fields: RField[]; steps: Step[]; show: string[] };

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
  samples: {
    key: 'samples', table: 'samples', label: 'Samples and gifts', one: 'sample entry', create: 'samples.create', view: 'samples.view',
    intro: 'What was handed out, to whom and at which customer. There is no approval step; managers see the log.',
    fields: [
      { key: 'customer_id', label: 'Customer', type: 'customer', required: true },
      { key: 'kind', label: 'What was given', type: 'select', options: ['Sample', 'Gift', 'Promotional material'], required: true },
      { key: 'product_id', label: 'Product (for a sample)', type: 'product' },
      { key: 'item', label: 'Item (for a gift or material)', type: 'text' },
      { key: 'qty', label: 'Quantity (units)', type: 'int', required: true },
      { key: 'given_to', label: 'Given to', type: 'text', required: true, help: 'Name and role, for example Dr. Sharma, purchase officer' },
      { key: 'remarks', label: 'Remarks', type: 'text', wide: true },
    ],
    steps: [], show: ['kind', 'product', 'item', 'qty', 'given_to'],
  },
  competitor: {
    key: 'competitor', table: 'competitor_info', label: 'Competitor information', one: 'competitor note', create: 'competitor.create', view: 'competitor.view',
    intro: 'Competitor rates and schemes seen in the market, with a photo where possible.',
    fields: [
      { key: 'customer_id', label: 'Seen at customer', type: 'customer' },
      { key: 'competitor', label: 'Competitor company', type: 'text', required: true },
      { key: 'their_product', label: 'Their product', type: 'text', required: true },
      { key: 'product_id', label: 'Our matching product', type: 'product' },
      { key: 'their_rate', label: 'Their rate (Rs per unit)', type: 'money' },
      { key: 'scheme', label: 'Their scheme', type: 'text', help: 'For example 10 + 2, or 5% cash discount' },
      { key: 'photo_id', label: 'Photo', type: 'photo' },
      { key: 'remarks', label: 'Remarks', type: 'text', wide: true },
    ],
    steps: [], show: ['competitor', 'their_product', 'product', 'their_rate', 'scheme'],
  },
};
