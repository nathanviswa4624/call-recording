'use client';
import { useQuery } from '@tanstack/react-query';
import { Activity, AudioLines, Cpu, Database, HardDrive, MemoryStick, Network, Server, Timer } from 'lucide-react';
import { asteriskApi } from '@/lib/api/asterisk';
import { reportApi } from '@/lib/api/reports';
import { useServer } from '@/lib/server-context';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import type { HealthLevel } from '@/lib/api/types';
import { MetricCard, PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList } from '@/components/ui/primitives';
import { EmptyState, ErrorState, InlineAlert, LoadingState, StatusBadge, type Tone } from '@/components/ui/feedback';

function uptime(sec: number | null | undefined) {
  if (!sec && sec !== 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return `${d ? `${d}d ` : ''}${h}h ${m}m`;
}

/** Healthy / Warning / Critical / Unknown with icon + label. */
function Health({ level, label }: { level: HealthLevel; label: string }) {
  const tone: Tone = level === 'HEALTHY' ? 'ok' : level === 'WARNING' ? 'warn' : level === 'CRITICAL' ? 'crit' : 'neutral';
  return <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"><span className="text-[13px]">{label}</span><StatusBadge tone={tone}>{level[0] + level.slice(1).toLowerCase()}</StatusBadge></div>;
}

export default function AsteriskStatusPage() {
  const { serverId, server } = useServer();
  const s = useQuery({ queryKey: ['asterisk', 'status', serverId], queryFn: () => asteriskApi.status(serverId!), enabled: Boolean(serverId), refetchInterval: 15_000 });
  const health = useQuery({ queryKey: ['system', 'health'], queryFn: reportApi.health, refetchInterval: 30_000 });
  const bridges = useQuery({ queryKey: ['asterisk', 'live', 'bridges', serverId], queryFn: () => asteriskApi.live('bridges', serverId!), enabled: Boolean(serverId && s.data?.connected), refetchInterval: 15_000 });
  if (!serverId) return <EmptyState title="No Asterisk server registered" />;
  const h = health.data?.asterisk.find((x) => x.id === serverId);
  const d = s.data;
  const pjsipLevel: HealthLevel = !d?.connected ? 'UNKNOWN' : d.endpoints && d.endpoints.unavailable.length > 0 ? 'WARNING' : 'HEALTHY';
  const disk = d?.system?.recordingDisk;
  const diskPct = disk ? 1 - disk.freeBytes / disk.totalBytes : 0;
  const diskLevel: HealthLevel = !disk ? 'UNKNOWN' : diskPct > 0.95 ? 'CRITICAL' : diskPct > 0.85 ? 'WARNING' : 'HEALTHY';
  const regsBad = d?.registrations?.filter((r) => !/Registered/i.test(r.status)).length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="System Status" description={<>Asterisk server <span className="font-medium text-text">{server?.name}</span> · refreshed every 15 s</>} actions={<Button size="sm" loading={s.isFetching} onClick={() => s.refetch()}>Refresh</Button>} />
      {s.isLoading ? <LoadingState /> : s.error ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : d && (
        <>
          {!d.connected && <InlineAlert tone="crit" title="Asterisk is not reachable">{d.error ?? 'The connector reports AMI is disconnected.'}</InlineAlert>}
          {d.restartRequired && <InlineAlert tone="warn" title="Restart required">Transport changes were applied and take effect after an Asterisk restart.</InlineAlert>}
          <div id="services" className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Health label="Database" level={health.data?.database.status ?? 'UNKNOWN'} />
            <Health label="Connector" level={h?.connector ?? 'UNKNOWN'} />
            <Health label="Asterisk process (AMI)" level={d.connected ? 'HEALTHY' : 'CRITICAL'} />
            <Health label="ARI" level={d.ari ? 'HEALTHY' : d.connected ? 'WARNING' : 'UNKNOWN'} />
            <Health label="PJSIP" level={pjsipLevel} />
            <Health label="Recording storage" level={diskLevel} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <MetricCard label="Version" icon={<Server className="size-3.5" />} value={<span className="text-[15px]">{d.version?.replace(/^Asterisk\s+/, '').split(' ')[0] ?? '—'}</span>} />
            <MetricCard label="Uptime" icon={<Timer className="size-3.5" />} value={<span className="text-[15px]">{uptime(d.uptimeSec)}</span>} />
            <MetricCard label="Active channels" icon={<Activity className="size-3.5" />} value={d.activeChannels ?? '—'} />
            <MetricCard label="Active calls" value={d.activeCalls ?? '—'} />
            <MetricCard label="Active bridges" value={bridges.data?.length ?? '—'} />
            <MetricCard label="Recording now" icon={<AudioLines className="size-3.5" />} value={d.recordingChannels ?? '—'} />
            <MetricCard label="Endpoints" icon={<Network className="size-3.5" />} value={d.endpoints ? `${d.endpoints.available}/${d.endpoints.total}` : '—'} hint="available / total" tone={d.endpoints?.unavailable.length ? 'warn' : undefined} />
            <MetricCard label="Registrations" value={d.registrations ? `${d.registrations.length - regsBad}/${d.registrations.length}` : '—'} hint="registered / total" tone={regsBad ? 'warn' : undefined} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Host">
              {d.system ? (
                <DefinitionList columns={2} items={[
                  ['Hostname', d.system.hostname], ['CPU', `${d.system.cpuPercent}% (load ${d.system.load1.toFixed(2)} on ${d.system.cpuCount} cores)`],
                  ['Memory', `${fmtBytes(d.system.memTotalBytes - d.system.memFreeBytes)} used of ${fmtBytes(d.system.memTotalBytes)}`],
                  ['Recording disk', disk ? `${fmtBytes(disk.totalBytes - disk.freeBytes)} used · ${fmtBytes(disk.freeBytes)} free (${Math.round(diskPct * 100)}%)` : 'Unavailable'],
                  ['Host uptime', uptime(d.system.uptimeSec)], ['Last seen', fmtDateTime(server?.lastSeenAt)],
                ]} />
              ) : <p className="text-[13px] text-muted">Host metrics unavailable.</p>}
              <div className="mt-3 flex gap-4 text-muted"><Cpu className="size-4" /><MemoryStick className="size-4" /><HardDrive className="size-4" /><Database className="size-4" /></div>
            </Card>
            <Card title="Trunk & endpoint problems">
              {d.endpoints?.unavailable.length || regsBad ? (
                <ul className="space-y-1 text-[13px]">
                  {d.endpoints?.unavailable.map((e) => <li key={e} className="flex items-center gap-2"><StatusBadge tone="crit">Unavailable</StatusBadge><span className="font-mono">{e}</span></li>)}
                  {d.registrations?.filter((r) => !/Registered/i.test(r.status)).map((r) => <li key={r.name} className="flex items-center gap-2"><StatusBadge tone="warn">{r.status}</StatusBadge><span className="font-mono">{r.name}</span><span className="text-muted">{r.serverUri}</span></li>)}
                </ul>
              ) : <p className="text-[13px] text-text-2">No unavailable endpoints or failed registrations.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
