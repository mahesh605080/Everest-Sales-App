'use client';
export default function PrintButton() {
  return <div className="noprint" style={{ display: 'flex', gap: 8 }}><button className="btn primary" onClick={() => window.print()}>Print or save as PDF</button><style>{'@media print{.noprint{display:none!important}}'}</style></div>;
}
