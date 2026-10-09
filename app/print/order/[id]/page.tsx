import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getOrder } from '@/lib/sales';
import PrintButton from '@/components/PrintButton';

export const dynamic = 'force-dynamic';
const rs = (n: number) => 'Rs ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PrintOrder({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) redirect('/login');
  let d: any; try { d = await getOrder(s, Number((await params).id)); } catch { notFound(); }
  const o = d.order, cell: React.CSSProperties = { border: '1px solid #999', padding: '6px 8px' }, lab: React.CSSProperties = { color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' };
  return (
    <div style={{ background: '#fff', color: '#000', minHeight: '100dvh', padding: 24, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13 }}>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PrintButton />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '2px solid #000', paddingBottom: 10, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 20, fontWeight: 700 }}>Everest Parenterals Pvt. Ltd.</div><div>Sales order</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 16, fontWeight: 700 }}>{o.no}</div><div>Date: {o.order_date}</div><div>Status: {o.status === 'Approved' ? 'Approved, dispatch pending' : o.status}</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <div><div style={lab}>Customer</div><b>{o.customer}</b><div>{o.customer_code}{o.town ? ` · ${o.town}` : ''}</div></div>
          <div><div style={lab}>Deliver to</div><div>{o.delivery_address || '–'}</div><div>{o.contact_person || ''} {o.contact_phone || ''}</div></div>
          <div><div style={lab}>Payment term</div><div>{o.term || '–'}</div></div>
          <div><div style={lab}>Transport</div><div>{o.transport}{o.transporter ? ` · ${o.transporter}` : ''}{o.vehicle_no ? ` · ${o.vehicle_no}` : ''}</div></div>
          <div><div style={lab}>Sales officer</div><div>{o.person} ({o.person_code})</div></div>
          <div><div style={lab}>Booklet</div><div>{o.booklet_no || 'Standard rates'}</div></div>
          {o.invoice_no && <div><div style={lab}>Invoice number</div><div>{o.invoice_no}</div></div>}
        </div>
        <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead><tr>{['#', 'Code', 'Product', 'Boxes', 'Units/box', 'Units', 'Rate', 'Value'].map((h, i) => <th key={h} style={{ ...cell, background: '#eee', textAlign: i > 2 ? 'right' : 'left', color: '#000', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>{h}</th>)}</tr></thead>
          <tbody>{d.items.map((i: any, n: number) => <tr key={i.id}><td style={cell}>{n + 1}</td><td style={cell}>{i.product_code}</td><td style={cell}>{i.product}{i.pack_size ? `, ${i.pack_size}` : ''}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{i.qty}</td><td style={{ ...cell, textAlign: 'right' }}>{i.units_per_box}</td><td style={{ ...cell, textAlign: 'right' }}>{i.qty * i.units_per_box}</td><td style={{ ...cell, textAlign: 'right' }}>{Number(i.rate).toFixed(2)}</td><td style={{ ...cell, textAlign: 'right' }}>{rs(i.value)}</td></tr>)}
            <tr><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }} colSpan={7}>Order value</td><td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{rs(o.value)}</td></tr></tbody>
        </table></div>
        {o.remarks && <div><span style={lab}>Remarks</span><div>{o.remarks}</div></div>}
        <div><div style={lab}>History</div>{d.trail.map((t: any, i: number) => <div key={i}>{new Date(t.at).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {t.action} by {t.user_name}{t.remarks ? ` · ${t.remarks}` : ''}</div>)}</div>
        <div style={{ color: '#555', fontSize: 11 }}>Rates are per unit and exclude taxes. This is an order record from the sales system, not a tax invoice.</div>
      </div>
    </div>
  );
}
