'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Info, Loader2, OctagonAlert, RefreshCw, X, XCircle } from 'lucide-react';
import { Button, cn } from './primitives';
import { errorMessage } from '@/lib/api/client';

/* ------------------------------------------------------------------ status */

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'neutral';
const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  crit: 'bg-crit-soft text-crit',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-3 text-text-2',
};
const TONE_ICON: Record<Tone, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, crit: XCircle, info: Info, neutral: CircleHelp };

/** Status is never conveyed by color alone: every badge has an icon and a text label. */
export function StatusBadge({ tone, children, icon = true, className }: { tone: Tone; children: ReactNode; icon?: boolean; className?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap', TONE_CLASS[tone], className)}>
      {icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

export function toneFor(status: string | null | undefined): Tone {
  switch ((status ?? '').toUpperCase()) {
    case 'HEALTHY': case 'REACHABLE': case 'ANSWERED': case 'APPLIED': case 'AVAILABLE': case 'SUCCESS': case 'OK': case 'ACTIVE': case 'REGISTERED': case 'AVAIL': case 'NOT_INUSE':
      return 'ok';
    case 'WARNING': case 'LAGGED': case 'NO_ANSWER': case 'BUSY': case 'APPLYING': case 'CLOSED': case 'PROCESSING': case 'RECORDING': case 'ABANDONED': case 'SKIPPED': case 'REJECTED_PENDING':
      return 'warn';
    case 'CRITICAL': case 'UNREACHABLE': case 'FAILED': case 'CONGESTION': case 'FAILURE': case 'MISSING_FILE': case 'UNAVAILABLE': case 'REJECTED': case 'DISABLED': case 'LOCKED':
      return 'crit';
    case 'UNKNOWN': case '':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function StatusText({ status }: { status: string | null | undefined }) {
  const s = status ?? 'UNKNOWN';
  return <StatusBadge tone={toneFor(s)}>{s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</StatusBadge>;
}

/* ------------------------------------------------------------------ states */

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon = CircleHelp, title, description, action }: { icon?: typeof CircleHelp; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icon className="size-7 text-muted" aria-hidden />
      <p className="text-[14px] font-medium text-text">{title}</p>
      {description && <p className="max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Could not load data' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <OctagonAlert className="size-6 text-crit" aria-hidden />
      <p className="text-[14px] font-medium text-text">{title}</p>
      <p className="max-w-lg text-[13px] text-muted">{errorMessage(error)}</p>
      {onRetry && <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function InlineAlert({ tone, title, children }: { tone: Tone; title?: ReactNode; children?: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <div role={tone === 'crit' ? 'alert' : 'status'} className={cn('flex gap-2 rounded-md border px-3 py-2 text-[13px]', TONE_CLASS[tone], 'border-current/20')}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 text-text">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-text-2">{children}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Dialog({ open, onClose, title, children, footer, width = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[width];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cn('w-full rounded-lg border border-border bg-surface shadow-xl outline-none', w)}>
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text"><X className="size-4" /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-4 py-2.5">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onCancel, onConfirm, title, children, confirmLabel = 'Confirm', danger, loading, requireText }: {
  open: boolean; onCancel: () => void; onConfirm: () => void; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  requireText?: string;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const blocked = Boolean(requireText) && typed !== requireText;
  return (
    <Dialog open={open} onClose={onCancel} title={title} width="sm" footer={
      <>
        <Button onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} disabled={blocked}>{confirmLabel}</Button>
      </>
    }>
      <div className="space-y-3 text-[13px] text-text-2">
        {children}
        {requireText && (
          <label className="block text-xs">
            Type <code className="font-mono font-semibold text-text">{requireText}</code> to confirm
            <input aria-label="Confirmation text" className="mt-1 h-8 w-full rounded-md border border-border-strong bg-surface px-2 font-mono text-[13px]" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ toasts */

interface Toast { id: number; tone: Tone; title: string; message?: string }
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.tone === 'crit' ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div key={t.id} className="pointer-events-auto flex gap-2 rounded-md border border-border bg-surface p-3 shadow-lg">
              <Icon className={cn('mt-0.5 size-4 shrink-0', { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', info: 'text-info', neutral: 'text-muted' }[t.tone])} aria-hidden />
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-text">{t.title}</p>
                {t.message && <p className="break-words text-text-2">{t.message}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return {
    success: (title: string, message?: string) => ctx?.push({ tone: 'ok', title, message }),
    error: (title: string, e?: unknown) => ctx?.push({ tone: 'crit', title, message: e === undefined ? undefined : errorMessage(e) }),
    info: (title: string, message?: string) => ctx?.push({ tone: 'info', title, message }),
  };
}
