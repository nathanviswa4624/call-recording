'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AudioWaveform, Bell, ChevronDown, LogOut, Menu, Moon, Server, Sun, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { reportApi } from '@/lib/api/reports';
import { cn } from '@/components/ui/primitives';
import { LoadingState, StatusBadge } from '@/components/ui/feedback';
import { NAV } from './nav';

const PRODUCT = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Echelons Call Recording';

function isActive(pathname: string, href: string): boolean {
  const h = href.split('#')[0]!;
  if (h === '/') return pathname === '/';
  if (h === '/calls') return pathname === '/calls' || /^\/calls\/[0-9a-f-]{36}/.test(pathname);
  return pathname === h || pathname.startsWith(`${h}/`);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { canAny } = useAuth();
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-sidebar text-sidebar-text">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/5 px-4">
        <AudioWaveform className="size-5 text-[#6aa3eb]" aria-hidden />
        <span className="truncate text-[14px] font-semibold text-white">{PRODUCT}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((section) => {
          const items = section.items.filter((i) => i.planned || !i.any || canAny(...i.any));
          if (!items.some((i) => !i.planned)) return null;
          return (
            <div key={section.label} className="mb-3">
              <p className="px-2 pb-1 text-[10.5px] font-semibold tracking-wider text-sidebar-muted uppercase">{section.label}</p>
              <ul>
                {items.map((item) => {
                  const Icon = item.icon;
                  if (item.planned) {
                    return (
                      <li key={item.label}>
                        <span aria-disabled="true" title="Not available in this release" className="flex h-7 cursor-not-allowed items-center gap-2 rounded px-2 text-[13px] text-sidebar-muted/70">
                          <Icon className="size-3.5" aria-hidden />
                          <span className="flex-1 truncate">{item.label}</span>
                          <span className="rounded bg-white/5 px-1 text-[10px]">Planned</span>
                        </span>
                      </li>
                    );
                  }
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.label}>
                      <Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                        className={cn('flex h-7 items-center gap-2 rounded px-2 text-[13px] transition-colors', active ? 'bg-sidebar-2 font-medium text-white' : 'hover:bg-sidebar-2 hover:text-white')}>
                        <Icon className={cn('size-3.5', active && 'text-[#6aa3eb]')} aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('ech.theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  return (
    <button type="button" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-text">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Health notifications derived from real status (no synthetic alerts). */
function Notifications() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['system', 'health'], queryFn: reportApi.health, enabled: status === 'authenticated', refetchInterval: 60_000 });
  const issues: string[] = [];
  if (q.data?.database.status === 'CRITICAL') issues.push('Database is unreachable');
  for (const s of q.data?.asterisk ?? []) {
    if (s.connector === 'CRITICAL') issues.push(`${s.name}: connector unreachable`);
    else if (s.ami !== 'HEALTHY') issues.push(`${s.name}: AMI not connected`);
    if (s.restartRequired) issues.push(`${s.name}: Asterisk restart required for transport changes`);
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={`Notifications (${issues.length})`} className="relative rounded p-1.5 text-muted hover:bg-surface-3 hover:text-text">
        <Bell className="size-4" />
        {issues.length > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-crit px-1 text-[9.5px] leading-[14px] font-semibold text-white">{issues.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-border bg-surface p-2 shadow-lg">
          <p className="px-1 pb-1 text-[11px] font-semibold text-muted uppercase">System notifications</p>
          {q.isLoading ? <p className="p-2 text-[13px] text-muted">Checking…</p> : issues.length === 0 ? (
            <p className="p-2 text-[13px] text-text-2">All systems reporting healthy.</p>
          ) : (
            <ul className="space-y-1">{issues.map((i) => <li key={i}><StatusBadge tone="crit">{i}</StatusBadge></li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, organizationName, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-surface-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{user?.name.slice(0, 2).toUpperCase()}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[12.5px] font-medium text-text">{user?.name}</span>
          <span className="block text-[11px] text-muted">{organizationName ?? ''}</span>
        </span>
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-border bg-surface py-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          <Link href="/profile" className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-3" onClick={() => setOpen(false)}><UserRound className="size-3.5" />Profile & password</Link>
          <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-3" onClick={async () => { await logout(); router.replace('/login'); }}>
            <LogOut className="size-3.5" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ServerSelector() {
  const { servers, serverId, setServerId } = useServer();
  if (servers.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 text-[12.5px] text-text-2">
      <Server className="size-3.5 text-muted" aria-hidden />
      <span className="sr-only">Asterisk server</span>
      <select value={serverId ?? ''} onChange={(e) => setServerId(e.target.value)} className="h-7 rounded border border-border bg-surface px-1.5 text-[12.5px]">
        {servers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.versionString ? ` · ${s.versionString.replace(/^Asterisk\s+/, '').split(' ')[0]}` : ''}</option>)}
      </select>
    </label>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'authenticated') return <LoadingState label="Checking session…" className="h-screen" />;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 lg:block"><Sidebar /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-64"><Sidebar onNavigate={() => setMobileOpen(false)} /></div>
          <button type="button" aria-label="Close navigation" className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
          <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-3 lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></button>
          <ServerSelector />
          <div className="flex-1" />
          <Notifications />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-5 py-4">{children}</main>
      </div>
    </div>
  );
}
