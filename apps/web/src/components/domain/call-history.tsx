'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, PhoneCall } from 'lucide-react';
import { callApi, type CallFilters } from '@/lib/api/calls';
import type { CallRow } from '@/lib/api/types';
import { fmtDateTime, fmtDuration, fmtHours, fmtNumber, fmtTime, toCsv, downloadText } from '@/lib/format';
import { DataTable, MetricCard, PageHeader } from '@/components/ui/data';
import { Button, Card } from '@/components/ui/primitives';
import { CallStatusCell, CallTypeCell, DirectionCell, Num, RecordingCell } from './call-cells';
import { SearchFilters, filtersFromParams, filtersToParams } from './search-filters';

export function CallHistory({ title, description, presetStatus }: { title: string; description: string; presetStatus?: string[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo<CallFilters>(() => ({ ...filtersFromParams(params), ...(presetStatus ? { status: presetStatus } : {}) }), [params, presetStatus]);
  const apply = (f: CallFilters) => {
    const p = filtersToParams(f);
    if (presetStatus) p.delete('status');
    router.replace(`${pathname}${p.toString() ? `?${p}` : ''}`);
  };

  const q = useInfiniteQuery({
    queryKey: ['calls', 'list', filters],
    queryFn: ({ pageParam }) => callApi.list({ ...filters, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const summary = useQuery({ queryKey: ['calls', 'summary', filters], queryFn: () => callApi.summary(filters) });
  const rows = q.data?.pages.flatMap((p) => p.items);

  const exportCsv = () => {
    if (!rows?.length) return;
    downloadText(`calls-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows as unknown as Array<Record<string, unknown>>, [
      { key: 'start_time', label: 'Start' }, { key: 'answer_time', label: 'Answer' }, { key: 'end_time', label: 'End' }, { key: 'caller_number', label: 'Caller' },
      { key: 'destination_number', label: 'Destination' }, { key: 'extension', label: 'Extension' }, { key: 'direction', label: 'Direction' },
      { key: 'call_type_name', label: 'Call type' }, { key: 'route_name', label: 'Route' }, { key: 'trunk_name', label: 'Trunk' }, { key: 'billsec', label: 'Billable seconds' },
      { key: 'answer_status', label: 'Status' }, { key: 'has_recording', label: 'Recording' }, { key: 'uniqueid', label: 'Unique ID' },
    ]));
  };

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={<Button icon={<Download className="size-3.5" />} disabled={!rows?.length} onClick={exportCsv} title="Exports the rows currently loaded">Export CSV</Button>} />
      <SearchFilters key={params.toString()} value={filters} onApply={apply} presetStatus={presetStatus} />
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <MetricCard label="Calls" value={fmtNumber(summary.data.total)} />
          <MetricCard label="Answered" value={fmtNumber(summary.data.answered)} />
          <MetricCard label="Missed" value={fmtNumber(summary.data.missed)} />
          <MetricCard label="Failed / busy" value={fmtNumber(summary.data.failed + summary.data.busy)} />
          <MetricCard label="Inbound / outbound" value={`${fmtNumber(summary.data.inbound)} / ${fmtNumber(summary.data.outbound)}`} />
          <MetricCard label="Talk time" value={fmtHours(summary.data.total_billsec)} hint={`avg ${fmtDuration(summary.data.avg_billsec)}`} />
          <MetricCard label="Recorded" value={fmtNumber(summary.data.recordings)} />
        </div>
      )}
      <Card bodyClassName="p-0">
        <DataTable<CallRow> rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.id} dense
          onRowClick={(r) => router.push(`/calls/${r.id}`)}
          hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => q.fetchNextPage()}
          empty={{ icon: PhoneCall, title: presetStatus ? 'No missed calls' : 'No calls found', description: 'Adjust the filters, or check that the CDR worker is importing calls.' }}
          columns={[
            { key: 'start', header: 'Start', sort: (r) => r.start_time, cell: (r) => <span className="tabular whitespace-nowrap">{fmtDateTime(r.start_time)}</span> },
            { key: 'ans', header: 'Answer', cell: (r) => <span className="tabular text-text-2">{fmtTime(r.answer_time)}</span> },
            { key: 'end', header: 'End', cell: (r) => <span className="tabular text-text-2">{fmtTime(r.end_time)}</span> },
            { key: 'from', header: 'Caller', sort: (r) => r.caller_number, cell: (r) => <Num>{r.caller_number}</Num> },
            { key: 'to', header: 'Destination', sort: (r) => r.destination_number, cell: (r) => <Num>{r.destination_number}</Num> },
            { key: 'ext', header: 'Ext.', cell: (r) => <Num>{r.extension}</Num> },
            { key: 'dir', header: 'Direction', cell: (r) => <DirectionCell direction={r.direction} /> },
            { key: 'type', header: 'Call type', cell: (r) => <CallTypeCell name={r.call_type_name} color={r.call_type_color} /> },
            { key: 'route', header: 'Route', cell: (r) => r.route_name ?? <span className="text-muted">—</span> },
            { key: 'trunk', header: 'Trunk', cell: (r) => r.trunk_name ?? <span className="text-muted">—</span> },
            { key: 'dur', header: 'Duration', align: 'right', sort: (r) => r.billsec, cell: (r) => fmtDuration(r.billsec) },
            { key: 'st', header: 'Status', cell: (r) => <CallStatusCell status={r.answer_status} /> },
            { key: 'rec', header: 'Recording', cell: (r) => <RecordingCell has={r.has_recording} /> },
          ]} />
      </Card>
      {q.hasNextPage === false && rows && rows.length > 0 && <p className="text-center text-[12px] text-muted">End of results · <Link className="hover:underline" href="/recordings">Search recordings</Link></p>}
    </div>
  );
}
