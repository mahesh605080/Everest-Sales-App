'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="login"><div className="card" style={{ maxWidth: 420 }}><h1 style={{ fontFamily: 'var(--display)', fontSize: 22, margin: 0 }}>Something went wrong on this page</h1>
    <p className="sub">Nothing you saved earlier is lost. Try again; if it keeps happening, tell the Admin which page it was and what you clicked.</p>
    <div style={{ display: 'flex', gap: 8 }}><button className="btn primary" onClick={() => reset()}>Try again</button><a className="btn" href="/dashboard">Dashboard</a></div></div></div>;
}
