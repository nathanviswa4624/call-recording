'use client';
import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AudioLines, ExternalLink, Play } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { recordingApi } from '@/lib/api/recordings';
import type { CallFilters } from '@/lib/api/calls';
import type { RecordingRow } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { fmtBytes, fmtDateTime, fmtDuration } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card } from '@/components/ui/primitives';
import { CallStatusCell, CallTypeCell, DirectionCell, Num, RecordingCell } from '@/components/domain/call-cells';
import { SearchFilters, filtersFromParams, filtersToParams } from '@/components/domain/search-filters';
import { AudioPlayer } from '@/components/domain/audio-player';

function RecordingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAuth();
  const filters = useMemo<CallFilters>(() => filtersFromParams(params), [params]);
  const [selected, setSelected] = useState<RecordingRow | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['recordings', filters],
    queryFn: ({ pageParam }) => recordingApi.list({ ...filters, limit: 50, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);
  const playable = (r: RecordingRow) => r.state === 'AVAILABLE' || r.state === 'ARCHIVED';

  return (
    <div className="space-y-4">
      <PageHeader title="Recordings" description="Search recorded calls. Audio is streamed through the authenticated API only." />
      <SearchFilters key={params.toString()} value={filters} onApply={(f) => { const p = filtersToParams(f); router.replace(`${pathname}${p.toString() ? `?${p}` : ''}`); }} />
      {selected && (
        <Card title={<span className="flex items-center gap-2"><AudioLines className="size-4 text-primary" />{selected.caller_number ?? 'Unknown'} → {selected.destination_number ?? 'Unknown'} · {fmtDateTime(selected.start_time)}</span>}
          actions={<>
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => router.push(`/calls/${selected.call_id}`)}>Call details</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </>}>
          <AudioPlayer key={selected.recording_id} recordingId={selected.recording_id} channels={{ mixed: true, caller: selected.layout === 'MIXED_AND_SPLIT', callee: selected.layout === 'MIXED_AND_SPLIT' }} canDownload={can(P.RECORDINGS_DOWNLOAD)} autoPlay />
          <p className="mt-2 text-[12.5px] text-text-2">
            {[selected.pbx_name && `PBX ${selected.pbx_name}`, selected.trunk_name && `Trunk ${selected.trunk_name}`, selected.route_name && `Route ${selected.route_name}`, selected.route_pattern && `Pattern ${selected.route_pattern}`, selected.call_type_name, selected.direction.toLowerCase(), `talk time ${fmtDuration(selected.billsec)}`].filter(Boolean).join(' · ')}
          </p>
        </Card>
      )}
      <Card bodyClassName="p-0">
        <DataTable<RecordingRow> rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.recording_id} dense
          selectedKey={selected?.recording_id} onRowClick={(r) => router.push(`/calls/${r.call_id}`)}
          hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => q.fetchNextPage()}
          empty={{ icon: AudioLines, title: 'No recordings found', description: 'Recordings appear after recorded calls are imported. Adjust the filters or check the recording policy of your routes.' }}
          columns={[
            {
              key: 'play', header: '', cell: (r) => (
                <Button size="sm" variant={selected?.recording_id === r.recording_id ? 'primary' : 'ghost'} aria-label="Play recording" disabled={!playable(r)}
                  icon={<Play className="size-3.5" />} onClick={(e) => { e.stopPropagation(); setSelected(r); }} />
              ),
            },
            { key: 'dt', header: 'Date / time', sort: (r) => r.start_time, cell: (r) => <span className="tabular whitespace-nowrap">{fmtDateTime(r.start_time)}</span> },
            { key: 'from', header: 'Caller', cell: (r) => <Num>{r.caller_number}</Num> },
            { key: 'to', header: 'Called', cell: (r) => <Num>{r.destination_number}</Num> },
            { key: 'ext', header: 'Ext.', cell: (r) => <Num>{r.extension}</Num> },
            { key: 'dir', header: 'Direction', cell: (r) => <DirectionCell direction={r.direction} /> },
            { key: 'type', header: 'Call type', cell: (r) => <CallTypeCell name={r.call_type_name} /> },
            { key: 'route', header: 'Route', cell: (r) => r.route_name ?? <span className="text-muted">—</span> },
            { key: 'trunk', header: 'Trunk', cell: (r) => r.trunk_name ?? <span className="text-muted">—</span> },
            { key: 'dur', header: 'Duration', align: 'right', sort: (r) => r.billsec, cell: (r) => fmtDuration(r.duration_sec ?? r.billsec) },
            { key: 'size', header: 'Size', align: 'right', cell: (r) => fmtBytes(r.size_bytes) },
            { key: 'rec', header: 'Recording', cell: (r) => <RecordingCell has state={r.state} /> },
            { key: 'st', header: 'Status', cell: (r) => <CallStatusCell status={r.answer_status} /> },
          ]} />
      </Card>
    </div>
  );
}

export default function RecordingsPage() {
  return <Suspense><RecordingsInner /></Suspense>;
}
