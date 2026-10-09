import Link from 'next/link';

export default function NotFound() {
  return <div className="login"><div className="card" style={{ maxWidth: 420 }}><h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: 0 }}>This page does not exist</h1>
    <p className="sub">The link may be old, or the record may be outside your territory.</p><div><Link className="btn primary" href="/dashboard">Go to the dashboard</Link></div></div></div>;
}
