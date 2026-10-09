'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call, initials } from '@/lib/ui';

type Item = { href: string; label: string };
type Group = { group: string; items: Item[] };
const SOON = [['Android app, background tracking', 'Phase 2'], ['Collection, claims, expenses', 'Phase 4'], ['Targets, scorecard, reports', 'Phase 5']];

export default function Shell({ user, nav, titles, children }: { user: { name: string; role_name: string; must_change_password: boolean }; nav: Group[]; titles: Record<string, [string, string]>; children: React.ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [toastMsg, setToast] = useState('');
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
    setMenu(false);
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
              <div className="usermenu">
                <button onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu">
                  <div className="av">{initials(user.name)}</div><div>{user.name}<br /><span className="code">{user.role_name}</span></div>
                </button>
                {menu && <div className="menu" role="menu"><Link href="/profile" role="menuitem">Change password</Link><button role="menuitem" onClick={logout}>Log out</button></div>}
              </div>
            </div>
          </div>
          <main id="view">
            {user.must_change_password && path !== '/profile' && <div className="banner">You are using a temporary password. <Link href="/profile">Change it now</Link>.</div>}
            {children}
          </main>
        </div>
      </div>
      {toastMsg && <div id="toast" role="status">{toastMsg}</div>}
    </>
  );
}
