'use client';
/**
 * Selected Asterisk server (most configuration is per server). The choice is a
 * per-viewer convenience kept in localStorage — it is not a secret and the
 * backend still checks the server belongs to the caller's organisation.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { asteriskApi } from './api/asterisk';
import type { AsteriskServer } from './api/types';
import { useAuth } from './auth';

interface ServerCtx { servers: AsteriskServer[]; server: AsteriskServer | null; serverId: string | null; setServerId: (id: string) => void; loading: boolean; error: unknown }
const Ctx = createContext<ServerCtx | null>(null);
const KEY = 'ech.serverId';

export function ServerProvider({ children }: { children: ReactNode }) {
  const { status, can } = useAuth();
  const enabled = status === 'authenticated' && can('system.view');
  const q = useQuery({ queryKey: ['asterisk', 'servers'], queryFn: asteriskApi.servers, enabled, staleTime: 60_000 });
  const [serverId, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data?.length) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    setId((cur) => cur && q.data!.some((s) => s.id === cur) ? cur : stored && q.data!.some((s) => s.id === stored) ? stored : q.data![0]!.id);
  }, [q.data]);

  const value = useMemo<ServerCtx>(() => ({
    servers: q.data ?? [],
    server: q.data?.find((s) => s.id === serverId) ?? null,
    serverId,
    setServerId: (id) => { setId(id); try { localStorage.setItem(KEY, id); } catch { /* ignore */ } },
    loading: q.isLoading,
    error: q.error,
  }), [q.data, q.isLoading, q.error, serverId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServer(): ServerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useServer outside ServerProvider');
  return c;
}
