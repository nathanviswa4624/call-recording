'use client';
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { Button, cn } from './primitives';
import { EmptyState, ErrorState, LoadingState } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for client-side sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: string;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode; icon?: Parameters<typeof EmptyState>[0]['icon'] };
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** Keyset pagination ("Load more"). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  dense?: boolean;
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, onRowClick, selectedKey, hasMore, loadingMore, onLoadMore, dense, caption }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, columns]);

  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingState />;
  if (!sorted?.length) return empty ? <EmptyState {...empty} /> : <EmptyState title="No records" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border bg-surface-2">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" style={{ width: c.width }} className={cn('px-3 py-2 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}
                  aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.sort ? (
                    <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-text" onClick={() => setSort(active ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                      {c.header}
                      {active && (sort!.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
            {onRowClick && <th className="w-6" aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k}
                className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2', selectedKey === k && 'bg-primary-soft')}
                onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={cn(dense ? 'px-3 py-1.5' : 'px-3 py-2', 'align-middle', c.align === 'right' ? 'text-right tabular' : c.align === 'center' ? 'text-center' : '', c.className)}>{c.cell(r)}</td>
                ))}
                {onRowClick && <td className="pr-2 text-muted"><ChevronRight className="size-3.5" aria-hidden /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {(hasMore || loadingMore) && (
        <div className="flex justify-center border-t border-border p-2">
          <Button size="sm" onClick={onLoadMore} loading={loadingMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: ReactNode; actions?: ReactNode; breadcrumbs?: Array<{ label: string; href?: string }> }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
            {breadcrumbs.map((b, i) => (
              <span key={b.label} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {b.href ? <Link className="hover:text-text" href={b.href}>{b.label}</Link> : <span>{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[19px] font-semibold tracking-tight text-text">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'crit' | 'warn' | 'ok' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="text-muted" aria-hidden>{icon}</span>}
      </div>
      <div className={cn('text-[22px] font-semibold leading-tight tabular', tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-text')}>{value}</div>
      {hint && <div className="truncate text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
