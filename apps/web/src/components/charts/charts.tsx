'use client';
/**
 * Minimal, dependency-free SVG/HTML charts following the data-viz method:
 * one hue per series (validated reference palette slots via CSS vars),
 * thin marks with rounded data-ends, recessive grid, single axis,
 * hover tooltips with hit targets larger than marks, text in text tokens,
 * and a table view for accessibility. No dual axes, no rainbow.
 */
import { useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { cn } from '../ui/primitives';
import { EmptyState } from '../ui/feedback';

export interface Datum { label: string; value: number; secondary?: number }

export function ChartCard({ title, subtitle, children, table, empty, legend }: { title: string; subtitle?: string; children: ReactNode; table?: Array<{ label: string; values: Array<[string, string]> }>; empty?: boolean; legend?: Array<{ label: string; color: string }> }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-text">{title}</h3>
          {subtitle && <p className="text-[12px] text-muted">{subtitle}</p>}
        </div>
        {table && !empty && (
          <button type="button" onClick={() => setAsTable((v) => !v)} aria-label={asTable ? 'Show chart' : 'Show table'} title={asTable ? 'Show chart' : 'Show table'} className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text">
            {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          </button>
        )}
      </header>
      {legend && !empty && (
        <div className="flex gap-3 px-3.5 pt-1 text-[12px] text-text-2">
          {legend.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
      <div className="min-h-0 flex-1 px-3.5 pt-2 pb-3">
        {empty ? <EmptyState title="No data for this period" /> : asTable && table ? (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {table.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-text-2">{r.label}</th>
                    {r.values.map(([k, v]) => <td key={k} className="py-1 text-right tabular text-text" title={k}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Vertical bar chart over an ordered axis (hours, days). Optional second series
 * is drawn as a side-by-side bar (2px surface gap) — same axis, same unit.
 */
export function ColumnChart({ data, height = 180, format = (n: number) => String(n), seriesNames }: { data: Datum[]; height?: number; format?: (n: number) => string; seriesNames?: [string, string] }) {
  const [hover, setHover] = useState<number | null>(null);
  const two = Boolean(seriesNames);
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0))));
  const W = 600;
  const H = height;
  const padL = 30, padB = 18, padT = 6;
  const plotW = W - padL;
  const plotH = H - padB - padT;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(two ? 10 : 18, slot * (two ? 0.34 : 0.62)));
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 12);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Column chart">
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{format(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const h1 = (d.value / max) * plotH;
          const h2 = ((d.secondary ?? 0) / max) * plotH;
          const x1 = two ? cx - barW - 1 : cx - barW / 2;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH} fill={hover === i ? 'var(--surface-3)' : 'transparent'} />
              {h1 > 0 && <path d={roundedTop(x1, padT + plotH - h1, barW, h1)} fill="var(--series-1)" />}
              {two && h2 > 0 && <path d={roundedTop(cx + 1, padT + plotH - h2, barW, h2)} fill="var(--series-2)" />}
              {i % labelEvery === 0 && <text x={cx} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-[12px] shadow-md" style={{ left: `${Math.min(80, ((hover + 0.5) / data.length) * 100)}%` }}>
          <p className="font-medium text-text">{data[hover]!.label}</p>
          <p className="text-text-2 tabular">{seriesNames?.[0] ?? 'Value'}: {format(data[hover]!.value)}</p>
          {two && <p className="text-text-2 tabular">{seriesNames![1]}: {format(data[hover]!.secondary ?? 0)}</p>}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Ranked horizontal bars for categorical breakdowns (single series, single hue). */
export function BarList({ data, format = (n: number) => String(n), max: maxRows = 8 }: { data: Datum[]; format?: (n: number) => string; max?: number }) {
  const rows = data.slice(0, maxRows);
  const max = Math.max(1, ...rows.map((d) => d.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((d) => (
        <li key={d.label} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12.5px]" title={`${d.label}: ${format(d.value)}`}>
          <span className="truncate text-text-2">{d.label}</span>
          <span className="h-2.5 rounded-sm bg-surface-3">
            <span className={cn('block h-full rounded-r-[4px] rounded-l-sm group-hover:opacity-85')} style={{ width: `${(d.value / max) * 100}%`, background: 'var(--series-1)', minWidth: d.value > 0 ? 3 : 0 }} />
          </span>
          <span className="text-right text-text tabular">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
