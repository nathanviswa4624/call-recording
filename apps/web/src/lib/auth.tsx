'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onSessionChange, refreshSession, type SessionUser } from './api/client';
import { authApi } from './api/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  organizationName: string | null;
  can: (...perms: string[]) => boolean;
  canAny: (...perms: string[]) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** Exported for tests only; application code uses AuthProvider / useAuth. */
export const AuthContext = createContext<AuthContextValue | null>(null);
export type { AuthContextValue };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [organizationName, setOrg] = useState<string | null>(null);

  useEffect(() => {
    const off = onSessionChange((u) => {
      setUser(u);
      setStatus(u ? 'authenticated' : 'anonymous');
    });
    // Restore the session from the HttpOnly refresh cookie (nothing is read from storage).
    refreshSession().then((s) => { if (!s) setStatus('anonymous'); });
    return () => { off(); };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') { setOrg(null); return; }
    authApi.me().then((m) => setOrg(m.organization?.name ?? null)).catch(() => setOrg(null));
  }, [status]);

  // Access tokens last 15 minutes; refresh proactively at 12.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const t = setInterval(() => { void refreshSession(); }, 12 * 60_000);
    return () => clearInterval(t);
  }, [status]);

  const perms = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const can = useCallback((...p: string[]) => p.every((x) => perms.has(x)), [perms]);
  const canAny = useCallback((...p: string[]) => p.some((x) => perms.has(x)), [perms]);
  const login = useCallback(async (u: string, p: string) => { await authApi.login(u, p); }, []);
  const logout = useCallback(async () => { await authApi.logout(); }, []);

  return <AuthContext.Provider value={{ status, user, organizationName, can, canAny, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/**
 * Hides UI the user cannot use. This is a UX aid only: the backend enforces
 * every permission independently (docs/08 §2).
 */
export function PermissionGuard({ all, any, children, fallback = null }: { all?: string[]; any?: string[]; children: ReactNode; fallback?: ReactNode }) {
  const { can, canAny } = useAuth();
  const ok = (all ? can(...all) : true) && (any ? canAny(...any) : true);
  return <>{ok ? children : fallback}</>;
}
