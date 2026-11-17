'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Split } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { routeApi } from '@/lib/api/routes';
import type { PatternListItem } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDuration, fmtHours, fmtNumber, startOfToday, toLocalInput } from '@/lib/format';
import { DataTable, MetricCard, PageHeader } from '@/components/ui/data';
import { Button, Card, Field, Input } from '@/components/ui/primitives';
import { Dialog, ErrorState, LoadingState, StatusBadge } from '@/components/ui/feedback';

function PatternStats({ p }: { p: PatternListItem }) {
  const [from, setFrom] = useState(toLocalInput(new Date(startOfToday().getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const q = useQuery({ queryKey: ['pattern-stats', p.id, from, to], queryFn: () => routeApi.patternStats(p.id, new Date(from).toISOString(), new Date(to).toISOString()) });
  const callsHref = `/calls?routePatternId=${p.id}&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From">{(id) => <Input id={id} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <Link href={callsHref}><Button variant="primary">Show matching calls</Button></Link>
      </div>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricCard label="Total calls" value={fmtNumber(q.data.totalCalls)} />
          <MetricCard label="Inbound" value={fmtNumber(q.data.inbound)} />
          <MetricCard label="Outbound" value={fmtNumber(q.data.outbound)} />
          <MetricCard label="Answered" value={fmtNumber(q.data.answered)} />
          <MetricCard label="Failed" value={fmtNumber(q.data.failed)} tone={q.data.failed ? 'crit' : undefined} />
          <MetricCard label="Average duration" value={fmtDuration(q.data.averageDurationSec)} />
          <MetricCard label="Total duration" value={fmtHours(q.data.totalDurationSec)} />
          <MetricCard label="Recordings" value={fmtNumber(q.data.recordings)} />
        </div>
      )}
    </div>
  );
}

export default function PatternsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['route-patterns'], queryFn: routeApi.patterns });
  const [stats, setStats] = useState<PatternListItem | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Route Patterns" description="Every dial pattern across all routes. Select a pattern to see its call statistics." actions={<Link href="/routing/routes"><Button>Manage routes</Button></Link>} />
      <Card bodyClassName="p-0">
        <DataTable<PatternListItem> rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.id}
          empty={{ icon: Split, title: 'No route patterns configured', action: <Link href="/routing/routes"><Button>Create Route</Button></Link> }}
          onRowClick={can(P.REPORTS_VIEW) ? setStats : undefined}
          columns={[
            { key: 'p', header: 'Pattern', sort: (r) => `${r.prefix ?? ''}${r.pattern}`, cell: (r) => <code className="font-mono">{r.prefix && <span className="text-primary">{r.prefix}</span>}{r.pattern}</code> },
            { key: 'route', header: 'Route', sort: (r) => r.route.name, cell: (r) => `${r.route.name} (#${r.route.routeNumber})` },
            { key: 'pbx', header: 'PBX', sort: (r) => r.route.pbx.name, cell: (r) => r.route.pbx.name },
            { key: 'prio', header: 'Priority', align: 'right', sort: (r) => r.route.priority, cell: (r) => r.route.priority },
            { key: 'dir', header: 'Direction', cell: (r) => r.route.direction.toLowerCase() },
            { key: 'strip', header: 'Strip', align: 'right', cell: (r) => (r.prefix?.length ?? 0) + r.stripDigits },
            { key: 'pre', header: 'Prepend', cell: (r) => <span className="font-mono">{r.prepend || '—'}</span> },
            { key: 'en', header: 'Status', cell: (r) => (r.enabled ? <StatusBadge tone="ok">Enabled</StatusBadge> : <StatusBadge tone="neutral">Disabled</StatusBadge>) },
            { key: 'st', header: '', cell: () => can(P.REPORTS_VIEW) ? <BarChart3 className="size-3.5 text-muted" aria-label="Statistics" /> : null },
          ]} />
      </Card>
      <Dialog open={Boolean(stats)} onClose={() => setStats(null)} width="lg" title={stats ? `Pattern ${stats.prefix ?? ''}${stats.pattern} — ${stats.route.name}` : ''}>
        {stats && <PatternStats p={stats} />}
      </Dialog>
    </div>
  );
}
