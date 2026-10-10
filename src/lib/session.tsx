import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, call, deviceInfo, getBase, loadConnection, setBase, setSignedOutHandler, setTokens } from './api';
import { forget } from './data';
import { clearOutbox, loadOutbox } from './outbox';
import { startNotifications, stopNotifications } from './notify';
import { kv } from './store';

export type User = { id: number; code: string; name: string; role: string; role_name: string; level: number; permissions: string[]; must_change_password: boolean; area_id: number | null; region_id: number | null };
type Ctx = { ready: boolean; user: User | null; server: string; can: (perm: string) => boolean; signIn: (server: string, login: string, password: string) => Promise<void>; signOut: () => Promise<void>; expire: () => Promise<void>; refreshUser: () => Promise<void> };
const SessionCtx = createContext<Ctx>(null as any);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [user, setUser] = useState<User | null>(null); const [server, setServer] = useState('');
  useEffect(() => { setSignedOutHandler(() => setUser(null)); (async () => {
    const c = await loadConnection(); setServer(c.base); await loadOutbox();
    if (c.token) {
      // Open straight away with the person we already know; confirm with the server in the background.
      const saved = await kv.get<User>('user'); if (saved) setUser(saved);
      try { const me = await call<{ user: User }>('/api/auth/me'); setUser(me.user); kv.set('user', me.user); startNotifications().catch(() => {}); }
      catch (e) { if (!(e instanceof ApiError && e.offline)) { setUser(null); } }
    }
    setReady(true);
  })(); }, []);
  const refreshUser = useCallback(async () => { const me = await call<{ user: User }>('/api/auth/me'); setUser(me.user); kv.set('user', me.user); }, []);
  const signIn = useCallback(async (srv: string, login: string, password: string) => {
    await setBase(srv); setServer(getBase());
    const r = await call<{ access_token: string; refresh_token: string }>('/api/v1/auth/login', { json: { login, password, device: await deviceInfo() } });
    await setTokens(r.access_token, r.refresh_token); await refreshUser(); startNotifications().catch(() => {});
  }, [refreshUser]);
  const signOut = useCallback(async () => {
    await stopNotifications().catch(() => {});
    try { await call('/api/v1/auth/logout', { method: 'POST', timeout: 5000 }); } catch { /* signing out works without a connection too */ }
    await setTokens(null, null); await kv.del('user'); await forget(); await clearOutbox(); setUser(null);
  }, []);
  // Ends the session on this phone but keeps saved lists and unsent work, for logging in again as the same person.
  const expire = useCallback(async () => { await setTokens(null, null); setUser(null); }, []);
  const value = useMemo<Ctx>(() => ({ ready, user, server, can: p => !!user?.permissions?.includes(p), signIn, signOut, expire, refreshUser }), [ready, user, server, signIn, signOut, expire, refreshUser]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
