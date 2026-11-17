'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Radio } from 'lucide-react';
import { callApi } from '@/lib/api/calls';
import type { LiveCall } from '@/lib/api/types';
import { useLiveEvents } from '@/hooks/use-live-events';
import { fmtDuration } from '@/lib/format';
import { DataTable, MetricCard, PageHeader } from '@/components/ui/data';
import { Card } from '@/components/ui/primitives';
import { InlineAlert, StatusBadge } from '@/components/ui/feedback';
import { DirectionCell, Num } from '@/components/domain/call-cells';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export default function LiveCallsPage() {
  const qc = useQueryClient();
  const now = useNow();
  // Snapshot from the connector via the backend; push events trigger refreshes.
  const q = useQuery({ queryKey: ['calls', 'live'], queryFn: callApi.live, refetchInterval: 15_000 });
  const live = useLiveEvents(['call.started', 'call.updated', 'call.ended', 'recording.started', 'recording.stopped'], () => { void qc.invalidateQueries({ queryKey: ['calls', 'live'] }); });
  const calls = q.data?.calls ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Live Calls" description="Active calls on all Asterisk servers, from AMI events."
        actions={<StatusBadge tone={live === 'connected' ? 'ok' : live === 'connecting' ? 'warn' : 'neutral'}><Radio className="size-3" />{live === 'connected' ? 'Live updates' : live === 'connecting' ? 'Connecting…' : 'Polling every 15 s'}</StatusBadge>} />
      {q.data?.errors.length ? <InlineAlert tone="warn" title="Some servers did not respond">{q.data.errors.map((e) => `${e.server}: ${e.error}`).join(' · ')}</InlineAlert> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Active calls" icon={<Activity className="size-3.5" />} value={calls.length} />
        <MetricCard label="Answered" value={calls.filter((c) => c.answered).length} />
        <MetricCard label="Ringing / setup" value={calls.filter((c) => !c.answered).length} />
        <MetricCard label="Being recorded" value={calls.filter((c) => c.recording === 'ACTIVE').length} />
      </div>
      <Card bodyClassName="p-0">
        <DataTable<LiveCall> rows={q.data ? calls : undefined} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(c) => `${c.serverId}:${c.linkedid}`}
          empty={{ icon: Activity, title: 'No active calls' }}
          columns={[
            { key: 'from', header: 'Caller', cell: (c) => <Num>{c.caller}</Num> },
            { key: 'to', header: 'Destination', cell: (c) => <Num>{c.destination}</Num> },
            { key: 'pbx', header: 'PBX', cell: (c) => c.pbxName ?? c.pbxCode ?? '—' },
            { key: 'route', header: 'Route', cell: (c) => c.routeName ?? '—' },
            { key: 'dir', header: 'Direction', cell: (c) => <DirectionCell direction={c.direction ?? 'UNKNOWN'} /> },
            { key: 'srv', header: 'Server', cell: (c) => c.serverName ?? '—' },
            { key: 'state', header: 'State', cell: (c) => <StatusBadge tone={c.answered ? 'ok' : 'warn'}>{c.answered ? 'Connected' : 'Ringing'}</StatusBadge> },
            { key: 'dur', header: 'Duration', align: 'right', cell: (c) => fmtDuration((now - c.startedAt) / 1000) },
            { key: 'rec', header: 'Recording', cell: (c) => c.recording === 'ACTIVE' ? <StatusBadge tone="crit" icon={false}><span className="size-2 animate-pulse rounded-full bg-crit" aria-hidden />Recording</StatusBadge> : <span className="text-muted">Not recording</span> },
          ]} />
      </Card>
      <p className="text-[12px] text-muted">Extension, trunk and call type are known once the call ends and its CDR is classified; live data comes from Asterisk channel variables.</p>
    </div>
  );
}
