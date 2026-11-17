'use client';
import { useMemo } from 'react';
import type { ConfigDiffResult } from '@/lib/api/types';
import { cn } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';

const TABLE_LABEL: Record<string, string> = {
  ps_endpoints: 'endpoint', ps_aors: 'AOR', ps_auths: 'auth', ps_endpoint_id_ips: 'identify', ps_registrations: 'registration', ps_domain_aliases: 'domain alias', ps_globals: 'global',
};

/** Line diff (LCS) for dialplan/transport text. Bounded for very large files. */
export function lineDiff(a: string, b: string): Array<{ op: ' ' | '+' | '-'; line: string }> {
  const A = a.split('\n');
  const B = b.split('\n');
  if (A.length * B.length > 4_000_000) {
    return [...A.filter((l) => !B.includes(l)).map((line) => ({ op: '-' as const, line })), ...B.filter((l) => !A.includes(l)).map((line) => ({ op: '+' as const, line }))];
  }
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<{ op: ' ' | '+' | '-'; line: string }> = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ op: ' ', line: A[i]! }); i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ op: '-', line: A[i]! }); i++; } else { out.push({ op: '+', line: B[j]! }); j++; }
  }
  while (i < A.length) out.push({ op: '-', line: A[i++]! });
  while (j < B.length) out.push({ op: '+', line: B[j++]! });
  return out;
}

/** Summary lines: "+ Added endpoint X", "- Removed …", "~ Changed …". */
export function diffSummary(d: ConfigDiffResult): Array<{ op: '+' | '-' | '~'; text: string }> {
  const out: Array<{ op: '+' | '-' | '~'; text: string }> = [];
  for (const [table, t] of Object.entries(d.tables)) {
    const label = TABLE_LABEL[table] ?? table;
    for (const id of t.added) out.push({ op: '+', text: `Added ${label} ${id}` });
    for (const id of t.removed) out.push({ op: '-', text: `Removed ${label} ${id}` });
    for (const c of t.changed) out.push({ op: '~', text: `Changed ${label} ${c.id}: ${c.fields.map((f) => `${f.field} ${f.from ?? '∅'} → ${f.to ?? '∅'}`).join(', ')}` });
  }
  if (d.dialplan.from !== d.dialplan.to) out.push({ op: '~', text: 'Changed generated dialplan' });
  if (d.transports.from !== d.transports.to) out.push({ op: '~', text: 'Changed transports (restart required)' });
  return out;
}

const OP_CLASS = { '+': 'bg-ok-soft text-ok', '-': 'bg-crit-soft text-crit', '~': 'bg-warn-soft text-warn', ' ': 'text-text-2' } as const;

export function ConfigDiff({ diff, contextLines = 2 }: { diff: ConfigDiffResult; contextLines?: number }) {
  const summary = useMemo(() => diffSummary(diff), [diff]);
  const dp = useMemo(() => lineDiff(diff.dialplan.from ?? '', diff.dialplan.to ?? '').filter((l) => !/config version \d+/.test(l.line)), [diff]);
  const tr = useMemo(() => lineDiff(diff.transports.from ?? '', diff.transports.to ?? '').filter((l) => !/config version \d+/.test(l.line)), [diff]);
  const compact = (lines: typeof dp) => lines.filter((l, i) => l.op !== ' ' || lines.slice(Math.max(0, i - contextLines), i + contextLines + 1).some((x) => x.op !== ' '));
  if (!summary.length) return <EmptyState title="No differences" description={`v${diff.from} and v${diff.to} are identical.`} />;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Changes v{diff.from} → v{diff.to}</p>
        <pre className="overflow-x-auto rounded-md border border-border p-2 font-mono text-[12px]">
          {summary.map((s, i) => <div key={i} className={cn('rounded px-1', OP_CLASS[s.op])}>{s.op} {s.text}</div>)}
        </pre>
      </div>
      {[['Generated dialplan', compact(dp)], ['Transports', compact(tr)]].map(([title, lines]) => (lines as typeof dp).some((l) => l.op !== ' ') && (
        <div key={title as string}>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{title as string}</p>
          <pre className="max-h-[50vh] overflow-auto rounded-md border border-border p-2 font-mono text-[11.5px] leading-relaxed">
            {(lines as typeof dp).map((l, i) => <div key={i} className={cn('px-1 whitespace-pre', OP_CLASS[l.op])}>{l.op} {l.line}</div>)}
          </pre>
        </div>
      ))}
    </div>
  );
}
