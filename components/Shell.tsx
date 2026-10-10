'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast, call, initials } from '@/lib/ui';
import { realtime } from '@/lib/realtime';

type Item = { href: string; label: string };
type Group = { group: string; items: Item[] };
const SOON = [['Android and iOS app', 'Next'], ['Samples, competitor info', 'Next'], ['Order PDF, SMS and push', 'Next']];

export default function Shell({ user, nav, primary = [], titles, today, children }: { user: { name: string; role_name: string; must_change_password: boolean }; nav: Group[]; primary?: Item[]; titles: Record<string, [string, string]>; today?: string; children: React.ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [toastMsg, setToast] = useState('');
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false); const [notes, setNotes] = useState<{ unread: number; items: any[] }>({ unread: 0, items: [] }); const [install, setInstall] = useState<any>(null);
  useEffect(() => {
    const load = () => call('/api/notifications').then(setNotes).catch(() => {});
    load(); const t = setInterval(load, 60000);
    // Live: a notification or a notice shows the moment it is made, without waiting for the next check.
    realtime.start();
    const off = realtime.on(e => { if (e.event === 'notification') { load(); toast(e.payload.title); } else if (e.event === 'notice') toast(`New notice: ${e.payload.title}`); else if (e.event === 'chat.message' && e.payload.sender_id !== realtime.userId && !location.pathname.startsWith('/chat')) toast(`${e.payload.sender}: ${String(e.payload.text).slice(0, 80)}`); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const onInstall = (e: any) => { e.preventDefault(); setInstall(e); };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => { off(); clearInterval(t); window.removeEventListener('beforeinstallprompt', onInstall); };
  }, []);
  async function openNote(n: any) { if (!n.read) await call('/api/notifications', { method: 'POST', json: { id: n.id } }).catch(() => {}); window.location.href = n.link || '/dashboard'; }
  async function readAll() { await call('/api/notifications', { method: 'POST', json: { id: 'all' } }).catch(() => {}); setNotes(n => ({ unread: 0, items: n.items.map(i => ({ ...i, read: true })) })); }
  const glow = useRef<HTMLDivElement>(null), prog = useRef<HTMLDivElement>(null), top = useRef<HTMLDivElement>(null);
  const key = Object.keys(titles).filter(k => path.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const [title, sub] = titles[key] || ['Everest SFA', ''];

  useEffect(() => {
    let t: any;
    const onToast = (e: any) => { setToast(e.detail); clearTimeout(t); t = setTimeout(() => setToast(''), 3200); };
    window.addEventListener('sfa-toast', onToast);
    return () => { window.removeEventListener('sfa-toast', onToast); clearTimeout(t); };
  }, []);

  // Cursor glow, card spotlight, button ripple, scroll progress.
  useEffect(() => {
    let raf = 0, px = 0, py = 0, last: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY;
      if (e.pointerType === 'mouse' && glow.current) glow.current.style.opacity = '1';
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (glow.current) glow.current.style.transform = `translate(${px}px,${py}px)`;
        const c = (document.elementFromPoint(px, py) as HTMLElement | null)?.closest?.('.card') as HTMLElement | null;
        if (last && last !== c) last.style.removeProperty('--mx');
        if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', px - r.left + 'px'); c.style.setProperty('--my', py - r.top + 'px'); }
        last = c;
      });
    };
    const click = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest?.('.btn') as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      const r = b.getBoundingClientRect(), z = Math.max(r.width, r.height) * 2, s = document.createElement('span');
      s.className = 'rip'; s.style.cssText = `width:${z}px;height:${z}px;left:${e.clientX - r.left - z / 2}px;top:${e.clientY - r.top - z / 2}px`;
      b.appendChild(s); setTimeout(() => s.remove(), 600);
    };
    const scroll = () => {
      const m = document.documentElement.scrollHeight - innerHeight;
      if (prog.current) prog.current.style.transform = `scaleX(${m > 0 ? scrollY / m : 0})`;
      top.current?.classList.toggle('scrolled', scrollY > 6);
    };
    const leave = () => { if (glow.current) glow.current.style.opacity = '0'; };
    document.addEventListener('pointermove', move); document.addEventListener('click', click);
    document.addEventListener('pointerleave', leave); addEventListener('scroll', scroll, { passive: true });
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('click', click); document.removeEventListener('pointerleave', leave); removeEventListener('scroll', scroll); };
  }, []);

  // Cards below the fold rise in as they are scrolled to.
  useEffect(() => {
    setMenu(false); setBell(false); setMore(false);
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    const t = setTimeout(() => document.querySelectorAll('#view .card:not(.rv)').forEach(c => { if (c.getBoundingClientRect().top > innerHeight * 0.92) { c.classList.add('rv'); io.observe(c); } }), 60);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [path]);

  async function logout() { await call('/api/auth/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/login'; }

  return (
    <>
      <div id="prog" ref={prog} /><div id="glow" ref={glow} />
      <div className="app">
        <aside>
          <div className="brand"><div className="mark">EP</div><div><b>Everest SFA</b><span>Control room</span></div></div>
          <nav aria-label="Sections">
            {nav.map(g => (
              <div key={g.group} style={{ display: 'contents' }}>
                <div className="grp">{g.group}</div>
                {g.items.map(i => <Link key={i.href} className="nv" href={i.href} aria-current={path === i.href || path.startsWith(i.href + '/') ? 'page' : undefined}>{i.label}</Link>)}
              </div>
            ))}
            <div className="grp">Coming next</div>
            {SOON.map(s => <div className="soon" key={s[0]}>{s[0]}<span>{s[1]}</span></div>)}
          </nav>
        </aside>
        <div className="main">
          <div className="top" id="top" ref={top}>
            <div><h1>{title}</h1><p>{sub}</p></div>
            <div className="ctl">
              {today && <span className="code today">{today}</span>}
              <div className="usermenu">
                <button onClick={() => { setBell(b => !b); setMenu(false); }} aria-expanded={bell} aria-label={`Notifications, ${notes.unread} unread`} style={{ position: 'relative' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
                  {notes.unread > 0 && <span className="badge" style={{ position: 'absolute', top: -2, right: -2 }}>{notes.unread > 99 ? '99+' : notes.unread}</span>}
                </button>
                {bell && <div className="menu" style={{ width: 340, maxWidth: '86vw', maxHeight: 420, overflowY: 'auto' }}>
                  <div className="hd" style={{ padding: '4px 8px' }}><b>Notifications</b>{notes.unread > 0 && <button onClick={readAll} style={{ color: 'var(--accent)', fontSize: 12 }}>Mark all read</button>}</div>
                  {notes.items.map(n => <button key={n.id} onClick={() => openNote(n)} style={{ display: 'block', whiteSpace: 'normal', borderLeft: n.read ? '3px solid transparent' : '3px solid var(--accent2)' }}>
                    <b style={{ fontWeight: n.read ? 500 : 700 }}>{n.title}</b>{n.body && <><br /><span className="sub">{n.body}</span></>}<br /><span className="code">{new Date(n.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' })}</span></button>)}
                  {!notes.items.length && <p className="sub" style={{ padding: 8 }}>Nothing yet. Approvals and decisions on your requests will appear here.</p>}
                </div>}
              </div>
              <div className="usermenu">
                <button onClick={() => { setMenu(m => !m); setBell(false); }} aria-expanded={menu} aria-haspopup="menu">
                  <div className="av">{initials(user.name)}</div><div>{user.name}<br /><span className="code">{user.role_name}</span></div>
                </button>
                {menu && <div className="menu" role="menu">{install && <button role="menuitem" onClick={async () => { install.prompt(); setInstall(null); }}>Install as an app</button>}<Link href="/profile" role="menuitem">Change password</Link><button role="menuitem" onClick={logout}>Log out</button></div>}
              </div>
            </div>
          </div>
          <main id="view">
            {user.must_change_password && path !== '/profile' && <div className="banner">You are using a temporary password. <Link href="/profile">Change it now</Link>.</div>}
            {children}
          </main>
        </div>
      </div>
      {primary.length > 0 && <div className="bottomnav" role="navigation" aria-label="Main">
        {primary.map(i => <Link key={i.href} href={i.href} aria-current={path === i.href || path.startsWith(i.href + '/') ? 'page' : undefined}>{i.label}</Link>)}
        <button onClick={() => setMore(m => !m)} aria-expanded={more}>{more ? 'Close' : 'More'}</button>
      </div>}
      {more && <div className="sheet" role="dialog" aria-label="All sections">
        {nav.map(g => <div key={g.group}><div className="grp">{g.group}</div><div className="sheetgrid">{g.items.map(i => <Link key={i.href} href={i.href} aria-current={path === i.href ? 'page' : undefined}>{i.label}</Link>)}</div></div>)}
      </div>}
      {toastMsg && <div id="toast" role="status">{toastMsg}</div>}
    </>
  );
}
