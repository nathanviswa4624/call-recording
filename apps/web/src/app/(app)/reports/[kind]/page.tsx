'use client';
import { Suspense, useMemo } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { reportApi, type ReportKind } from '@/lib/api/reports';
import { callApi, type CallFilters } from '@/lib/api/calls';
import type { ReportRow } from '@/lib/api/types';
import { downloadText, fmtDuration, fmtHours, fmtNumber, startOfToday, toCsv } from '@/lib/format';
import { DataTable, MetricCard, PageHeader } from '@/components/ui/data';
import { Button, Card } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';
import { BarList, ChartCard } from '@/components/charts/charts';
import { SearchFilters, filtersFromParams, filtersToParams } from '@/components/domain/search-filters';

const REPORTS: Record<string, { title: string; kind: ReportKind | null; label: string; description: string; recordedOnly?: boolean }> = {
  calls: { title: 'Call Report', kind: 'call-types', label: 'Call type', description: 'Call volume, outcomes and talk time for the selected period.' },
  recordings: { title: 'Recording Report', kind: 'pbx', label: 'PBX', description: 'Recorded calls by PBX.', recordedOnly: true },
  routes: { title: 'Route Report', kind: 'routes', label: 'Route (pattern)', description: 'Calls, outcomes and duration per route pattern.' },
  extensions: { title: 'Extension Report', kind: 'extensions', label: 'Extension', description: 'Activity per extension.' },
  trunks: { title: 'Trunk Report', kind: 'trunks', label: 'Trunk', description: 'Calls per SIP trunk.' },
  'call-types': { title: 'Call Type Report', kind: 'call-types', label: 'Call type', description: 'Internal, external, international, mobile, missed, failed…' },
};

function ReportInner() {
  const { kind } = useParams<{ kind: string }>();
  const meta = REPORTS[kind];
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo<CallFilters>(() => {
    const f = filtersFromParams(params);
    if (!f.from) f.from = new Date(startOfToday().getTime() - 29 * 86_400_000).toISOString();
    if (meta?.recordedOnly) f.hasRecording = 'true';
    return f;
  }, [params, meta]);
  const q = useQuery({ queryKey: ['report', kind, filters], queryFn: () => reportApi.report(meta!.kind!, filters), enabled: Boolean(meta) });
  const summary = useQuery({ queryKey: ['calls', 'summary', filters], queryFn: () => callApi.summary(filters), enabled: Boolean(meta) });
  if (!meta) return <EmptyState title="Unknown report" />;

  const exportCsv = () => downloadText(`${kind}-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(q.data!.rows as unknown as Array<Record<string, unknown>>, [
    { key: 'label', label: meta.label }, { key: 'calls', label: 'Calls' }, { key: 'answered', label: 'Answered' }, { key: 'missed', label: 'Missed' }, { key: 'failed', label: 'Failed/busy' },
    { key: 'inbound', label: 'Inbound' }, { key: 'outbound', label: 'Outbound' }, { key: 'total_billsec', label: 'Total seconds' }, { key: 'avg_billsec', label: 'Average seconds' }, { key: 'recordings', label: 'Recordings' },
  ]));

  return (
    <div className="space-y-4">
      <PageHeader title={meta.title} description={meta.description} actions={<Button icon={<Download className="size-3.5" />} disabled={!q.data?.rows.length} onClick={exportCsv}>Export CSV</Button>} />
      <SearchFilters key={params.toString()} value={filters} onApply={(f) => { const p = filtersToParams(f); router.replace(`${pathname}?${p}`); }} />
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="Calls" value={fmtNumber(summary.data.total)} />
          <MetricCard label="Answered" value={fmtNumber(summary.data.answered)} />
          <MetricCard label="Missed" value={fmtNumber(summary.data.missed)} />
          <MetricCard label="Total talk time" value={fmtHours(summary.data.total_billsec)} />
          <MetricCard label="Average" value={fmtDuration(summary.data.avg_billsec)} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard title={`Calls by ${meta.label.toLowerCase()}`} empty={!q.data?.rows.length} table={q.data?.rows.map((r) => ({ label: r.label, values: [['Calls', String(r.calls)]] }))}>
          <BarList data={(q.data?.rows ?? []).map((r) => ({ label: r.label, value: r.calls }))} max={12} />
        </ChartCard>
        <Card bodyClassName="p-0" className="xl:col-span-2">
          <DataTable<ReportRow> rows={q.data?.rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.label} dense
            empty={{ icon: BarChart3, title: 'No calls in this period' }}
            columns={[
              { key: 'l', header: meta.label, sort: (r) => r.label, cell: (r) => <span className="font-medium">{r.label}</span> },
              { key: 'c', header: 'Calls', align: 'right', sort: (r) => r.calls, cell: (r) => fmtNumber(r.calls) },
              { key: 'a', header: 'Answered', align: 'right', sort: (r) => r.answered, cell: (r) => fmtNumber(r.answered) },
              { key: 'm', header: 'Missed', align: 'right', sort: (r) => r.missed, cell: (r) => fmtNumber(r.missed) },
              { key: 'f', header: 'Failed', align: 'right', sort: (r) => r.failed, cell: (r) => fmtNumber(r.failed) },
              { key: 'i', header: 'In', align: 'right', cell: (r) => fmtNumber(r.inbound) },
              { key: 'o', header: 'Out', align: 'right', cell: (r) => fmtNumber(r.outbound) },
              { key: 't', header: 'Total', align: 'right', sort: (r) => r.total_billsec, cell: (r) => fmtHours(r.total_billsec) },
              { key: 'v', header: 'Average', align: 'right', sort: (r) => r.avg_billsec, cell: (r) => fmtDuration(r.avg_billsec) },
              { key: 'r', header: 'Recordings', align: 'right', cell: (r) => fmtNumber(r.recordings) },
            ]} />
        </Card>
      </div>
      <p className="text-[12px] text-muted">CSV export covers the rows shown. Excel and PDF exports are not available in this release.</p>
    </div>
  );
}

export default function ReportPage() {
  return <Suspense><ReportInner /></Suspense>;
}
