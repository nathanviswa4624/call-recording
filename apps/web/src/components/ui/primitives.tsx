'use client';
import clsx from 'clsx';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export const cn = clsx;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-3',
  ghost: 'bg-transparent text-text-2 border border-transparent hover:bg-surface-3 hover:text-text',
  danger: 'bg-crit text-white border border-transparent hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

const control = 'h-8 w-full rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-text placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-crit';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn(control, 'pr-7', className)} {...rest}>{children}</select>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'h-auto min-h-20 py-1.5 font-mono text-xs', className)} {...rest} />;
});

/** Label + control + help/error, wired for accessibility. */
export function Field({ label, error, help, required, children, className }: { label: string; error?: string; help?: ReactNode; required?: boolean; children: (id: string, describedBy: string | undefined) => ReactNode; className?: string }) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-text-2">
        {label}{required && <span className="text-crit"> *</span>}
      </label>
      {children(id, error || help ? msgId : undefined)}
      {error ? <p id={msgId} role="alert" className="text-xs text-crit">{error}</p> : help ? <p id={msgId} className="text-xs text-muted">{help}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-text">
      <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3.5 py-2">
          <h2 className="text-[13px] font-semibold text-text">{title}</h2>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cn('p-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <code className="rounded border border-border bg-surface-2 px-1 py-px font-mono text-[12px] text-text">{children}</code>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode }> }) {
  return (
    <div role="tablist" className="flex gap-0.5 border-b border-border">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          type="button"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px]', value === i.value ? 'border-primary font-medium text-text' : 'border-transparent text-muted hover:text-text')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function DefinitionList({ items, columns = 2 }: { items: Array<[string, ReactNode]>; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col">
          <dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt>
          <dd className="truncate text-[13px] text-text tabular">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
