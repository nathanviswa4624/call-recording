'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, AudioLines, Cable, Database, HardDrive, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Plus, Server } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { reportApi } from '@/lib/api/reports';
import { callApi } from '@/lib/api/calls';
import { asteriskApi } from '@/lib/api/asterisk';
import { useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { fmtBytes, fmtDuration, fmtHours, fmtNumber, fmtTime, startOfToday } from '@/lib/format';
import type { CallRow, HealthLevel } from '@/lib/api/types';
import { DataTable, MetricCard, PageHeader } from '@/components/ui/data';
import { Button, Card } from '@/components/ui/primitives';
import { ErrorState, LoadingState, StatusBadge, type Tone } from '@/components/ui/feedback';
import { BarList, ChartCard, ColumnChart } from '@/components/charts/charts';
import { CallStatusCell, CallTypeCell, DirectionCell, Num, RecordingCell } from '@/components/domain/call-cells';

const healthTone = (h: HealthLevel | undefined): Tone => (h === 'HEALTHY' ? 'ok' : h === 'WARNING' ? 'warn' : h === 'CRITICAL' ? 'crit' : 'neutral');
const healthLabel = (h: HealthLevel | undefined) => (h ? h[0] + h.slice(1).toLowerCase() : 'Unknown');

function Health() {
  const { can } = useAuth();
  const { serverId } = useServer();
  const health = useQuery({ queryKey: ['system', 'health'], queryFn: reportApi.health, refetchInterval: 60_000 });
  const status = useQuery({ queryKey: ['asterisk', 'status', serverId], queryFn: () => asteriskApi.status(serverId!), enabled: Boolean(serverId) && can(P.SYSTEM_VIEW), refetchInterval: 30_000 });
  const live = useQuery({ queryKey: ['calls', 'live'], queryFn: callApi.live, refetchInterval: 10_000 });
  const srv = health.data?.asterisk.find((s) => s.id === serverId) ?? health.data?.asterisk[0];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard label="Active calls" icon={<Activity className="size-3.5" />} value={live.isLoading ? '…' : live.error ? '—' : fmtNumber(live.data?.calls.length)} hint={live.data?.calls.filter((c) => c.recording === 'ACTIVE').length ? `${live.data!.calls.filter((c) => c.recording === 'ACTIVE').length} recording` : 'via AMI'} />
      <MetricCard label="Endpoints available" icon={<Cable className="size-3.5" />} value={status.data?.endpoints ? `${status.data.endpoints.available}/${status.data.endpoints.total}` : '—'} hint={status.data?.endpoints?.unavailable.length ? `${status.data.endpoints.unavailable.length} unavailable` : 'PJSIP'} tone={status.data?.endpoints?.unavailable.length ? 'warn' : undefined} />
      <MetricCard label="Registrations" icon={<Server className="size-3.5" />} value={status.data?.registrations ? `${status.data.registrations.filter((r) => /Registered/i.test(r.status)).length}/${status.data.registrations.length}` : '—'} hint="Outbound" />
      <div className="col-span-2 flex flex-col justify-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-3 md:col-span-3">
        <p className="text-[12px] text-muted">Platform health</p>
        {health.isLoading ? <span className="text-muted">Checking…</span> : health.error ? <StatusBadge tone="crit">Health check failed</StatusBadge> : (
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone={healthTone(health.data!.database.status)}><Database className="size-3" aria-hidden />Database: {healthLabel(health.data!.database.status)}</StatusBadge>
            {srv ? <>
              <StatusBadge tone={healthTone(srv.connector)}>Connector: {healthLabel(srv.connector)}</StatusBadge>
              <StatusBadge tone={healthTone(srv.ami)}>Asterisk AMI: {healthLabel(srv.ami)}</StatusBadge>
              {srv.version && <StatusBadge tone="neutral" icon={false}>{srv.version.split(' ').slice(0, 2).join(' ')}</StatusBadge>}
              {srv.restartRequired && <StatusBadge tone="warn">Restart required</StatusBadge>}
            </> : <StatusBadge tone="neutral">No Asterisk server registered</StatusBadge>}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentCalls() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['calls', 'recent'], queryFn: () => callApi.list({ from: startOfToday().toISOString(), limit: 12 }), refetchInterval: 30_000 });
  return (
    <Card title="Recent calls (today)" actions={<Link className="text-[12.5px] text-primary hover:underline" href="/calls">View all</Link>} bodyClassName="p-0">
      <DataTable<CallRow>
        rows={q.data?.items} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.id} dense
        onRowClick={(r) => router.push(`/calls/${r.id}`)}
        empty={{ icon: PhoneCall, title: 'No calls today', description: 'Calls appear here once Asterisk writes CDRs and the worker imports them.' }}
        columns={[
          { key: 't', header: 'Time', cell: (r) => <span className="tabular">{fmtTime(r.start_time)}</span> },
          { key: 'from', header: 'Caller', cell: (r) => <Num>{r.caller_number}</Num> },
          { key: 'to', header: 'Called number', cell: (r) => <Num>{r.destination_number}</Num> },
          { key: 'ext', header: 'Extension', cell: (r) => <Num>{r.extension}</Num> },
          { key: 'dir', header: 'Direction', cell: (r) => <DirectionCell direction={r.direction} /> },
          { key: 'type', header: 'Call type', cell: (r) => <CallTypeCell name={r.call_type_name} color={r.call_type_color} /> },
          { key: 'route', header: 'Route', cell: (r) => r.route_name ?? <span className="text-muted">—</span> },
          { key: 'dur', header: 'Duration', align: 'right', cell: (r) => fmtDuration(r.billsec) },
          { key: 'rec', header: 'Recording', cell: (r) => <RecordingCell has={r.has_recording} /> },
          { key: 'st', header: 'Status', cell: (r) => <CallStatusCell status={r.answer_status} /> },
        ]}
      />
    </Card>
  );
}

export default function DashboardPage() {
  const { can } = useAuth();
  const canReports = can(P.REPORTS_VIEW);
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => reportApi.dashboard(14), enabled: canReports, refetchInterval: 60_000 });
  const t = d.data?.today ?? {};
  const perHour = Array.from({ length: 24 }, (_, h) => {
    const row = d.data?.charts.perHour.find((r) => Number(r['hour']) === h);
    return { label: String(h).padStart(2, '0'), value: Number(row?.['inbound'] ?? 0), secondary: Number(row?.['outbound'] ?? 0) };
  });
  const toDatum = (rows: Array<Record<string, string | number | null>> | undefined) => (rows ?? []).map((r) => ({ label: String(r['label'] ?? '—'), value: Number(r['calls'] ?? 0) }));
  const perDay = (d.data?.charts.perDay ?? []).map((r) => ({ label: String(r['day']).slice(5, 10), value: Number(r['calls'] ?? 0) }));

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" description="Today's call activity and platform health." actions={
        can(P.TRUNKS_CONFIGURE) ? <Link href="/pbx/new"><Button size="sm" icon={<Plus className="size-3.5" />}>Configure PBX</Button></Link> : undefined
      } />
      <Health />
      {canReports && (d.isLoading ? <LoadingState /> : d.error ? <ErrorState error={d.error} onRetry={() => d.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <MetricCard label="Calls today" icon={<PhoneCall className="size-3.5" />} value={fmtNumber(t.total ?? 0)} />
            <MetricCard label="Incoming" icon={<PhoneIncoming className="size-3.5" />} value={fmtNumber(t.inbound ?? 0)} />
            <MetricCard label="Outgoing" icon={<PhoneOutgoing className="size-3.5" />} value={fmtNumber(t.outbound ?? 0)} />
            <MetricCard label="Internal" value={fmtNumber(t.internal ?? 0)} />
            <MetricCard label="Answered" value={fmtNumber(t.answered ?? 0)} />
            <MetricCard label="Missed" icon={<PhoneMissed className="size-3.5" />} value={fmtNumber(t.missed ?? 0)} tone={(t.missed ?? 0) > 0 ? 'warn' : undefined} />
            <MetricCard label="Failed / busy" value={fmtNumber((t.failed ?? 0) + (t.busy ?? 0))} tone={(t.failed ?? 0) > 0 ? 'crit' : undefined} />
            <MetricCard label="Active trunks" icon={<Cable className="size-3.5" />} value={fmtNumber(d.data!.infrastructure.active_trunks ?? 0)} hint={d.data!.infrastructure.failed_trunks ? `${d.data!.infrastructure.failed_trunks} unreachable` : undefined} tone={d.data!.infrastructure.failed_trunks ? 'crit' : undefined} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard label="Recordings stored" icon={<AudioLines className="size-3.5" />} value={fmtNumber(d.data!.recordings.total)} />
            <MetricCard label="Total recording duration" value={fmtHours(d.data!.recordings.durationSec)} />
            <MetricCard label="Recording storage used" icon={<HardDrive className="size-3.5" />} value={fmtBytes(d.data!.recordings.storageBytes)} />
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ChartCard title="Calls by hour (today)" subtitle="Inbound and outbound" empty={!t.total}
                legend={[{ label: 'Inbound', color: 'var(--series-1)' }, { label: 'Outbound', color: 'var(--series-2)' }]}
                table={perHour.filter((r) => r.value || r.secondary).map((r) => ({ label: `${r.label}:00`, values: [['Inbound', String(r.value)], ['Outbound', String(r.secondary)]] }))}>
                <ColumnChart data={perHour} seriesNames={['Inbound', 'Outbound']} />
              </ChartCard>
            </div>
            <ChartCard title="Calls by type" subtitle="Last 14 days" empty={!toDatum(d.data!.charts.byCallType).length} table={toDatum(d.data!.charts.byCallType).map((r) => ({ label: r.label, values: [['Calls', String(r.value)]] }))}>
              <BarList data={toDatum(d.data!.charts.byCallType)} />
            </ChartCard>
            <ChartCard title="Calls per day" subtitle="Last 14 days" empty={!perDay.length} table={perDay.map((r) => ({ label: r.label, values: [['Calls', String(r.value)]] }))}>
              <ColumnChart data={perDay} height={150} />
            </ChartCard>
            <ChartCard title="Calls by PBX / trunk source" subtitle="Last 14 days" empty={!toDatum(d.data!.charts.byPbx).length} table={toDatum(d.data!.charts.byPbx).map((r) => ({ label: r.label, values: [['Calls', String(r.value)]] }))}>
              <BarList data={toDatum(d.data!.charts.byPbx)} />
            </ChartCard>
            <ChartCard title="Calls by route" subtitle="Last 14 days" empty={!toDatum(d.data!.charts.byRoute).length} table={toDatum(d.data!.charts.byRoute).map((r) => ({ label: r.label, values: [['Calls', String(r.value)]] }))}>
              <BarList data={toDatum(d.data!.charts.byRoute)} />
            </ChartCard>
            <ChartCard title="Calls by extension" subtitle="Last 14 days" empty={!toDatum(d.data!.charts.byExtension).length} table={toDatum(d.data!.charts.byExtension).map((r) => ({ label: r.label, values: [['Calls', String(r.value)]] }))}>
              <BarList data={toDatum(d.data!.charts.byExtension)} />
            </ChartCard>
            <ChartCard title="Answered call duration" subtitle="Distribution, last 14 days" empty={!d.data!.charts.durationBuckets.length}
              table={['<30s', '30-60s', '1-3m', '3-10m', '10m+'].map((b) => ({ label: b, values: [['Calls', String(d.data!.charts.durationBuckets.find((r) => r['bucket'] === b)?.['calls'] ?? 0)]] }))}>
              <ColumnChart height={150} data={['<30s', '30-60s', '1-3m', '3-10m', '10m+'].map((b) => ({ label: b, value: Number(d.data!.charts.durationBuckets.find((r) => r['bucket'] === b)?.['calls'] ?? 0) }))} />
            </ChartCard>
            <ChartCard title="Average answered duration per day" subtitle="Seconds, last 14 days" empty={!perDay.length}
              table={(d.data!.charts.perDay).map((r) => ({ label: String(r['day']).slice(5, 10), values: [['Avg', fmtDuration(Number(r['avg_billsec'] ?? 0))]] }))}>
              <ColumnChart height={150} format={(n) => fmtDuration(n)} data={(d.data!.charts.perDay).map((r) => ({ label: String(r['day']).slice(5, 10), value: Number(r['avg_billsec'] ?? 0) }))} />
            </ChartCard>
          </div>
        </>
      ))}
      <RecentCalls />
    </div>
  );
}
