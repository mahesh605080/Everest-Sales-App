'use client';
import { useState } from 'react';
import { call } from '@/lib/ui';

export default function Login() {
  const [login, setLogin] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await call('/api/auth/login', { method: 'POST', json: { login, password } });
      window.location.href = r.user.must_change_password ? '/profile' : '/dashboard';
    } catch (x: any) { setErr(x.message); setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="mark">EP</div><div><b>Everest SFA</b><span>Everest Parenterals Pvt. Ltd.</span></div></div>
        <div><h1>Log in</h1><p className="sub">Use your employee code or mobile number.</p></div>
        {err && <div className="errbox" role="alert">{err}</div>}
        <div className="fld"><label htmlFor="login">Employee code or mobile number</label>
          <input id="login" type="text" autoComplete="username" autoFocus value={login} onChange={e => setLogin(e.target.value)} /></div>
        <div className="fld"><label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></div>
        <button className="btn primary" disabled={busy} style={{ padding: '10px 14px' }}>{busy ? 'Checking…' : 'Log in'}</button>
        <p className="sub">Forgot your password? Ask the Admin to reset it.</p>
      </form>
    </div>
  );
}
