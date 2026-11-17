'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { asteriskApi, type LiveKind } from '@/lib/api/asterisk';
import { useServer } from '@/lib/server-context';
import { DataTable, PageHeader, type Column } from '@/components/ui/data';
import { Button, Card, Tabs } from '@/components/ui/primitives';
import { EmptyState, StatusBadge } from '@/components/ui/feedback';

type Row = Record<string, string>;
const state = (v: string | undefined) => {
  const s = v ?? 'Unknown';
  const tone = /Unavailable|Unreachable|Rejected|Failed|Invalid/i.test(s) ? 'crit' : /Unknown|Created/i.test(s) ? 'neutral' : /Avail|Reachable|Registered|Not in use|In use|Ringing/i.test(s) ? 'ok' : 'neutral';
  return <StatusBadge tone={tone}>{s}</StatusBadge>;
};
const mono = (v?: string) => <span className="font-mono text-[12.5px]">{v || '—'}</span>;

const VIEWS: Record<Exclude<LiveKind, 'channels' | 'bridges'>, { label: string; columns: Column<Row>[] }> = {
  endpoints: { label: 'Endpoints', columns: [
    { key: 'n', header: 'Endpoint', sort: (r) => r['ObjectName'], cell: (r) => mono(r['ObjectName']) },
    { key: 't', header: 'Transport', cell: (r) => mono(r['Transport']) }, { key: 'a', header: 'AORs', cell: (r) => mono(r['Aor']) },
    { key: 'c', header: 'Active channels', align: 'right', cell: (r) => r['ActiveChannels'] ?? '0' }, { key: 's', header: 'Device state', cell: (r) => state(r['DeviceState']) },
  ] },
  contacts: { label: 'Contacts', columns: [
    { key: 'a', header: 'AOR', sort: (r) => r['Aor'], cell: (r) => mono(r['Aor']) }, { key: 'u', header: 'URI', cell: (r) => mono(r['Uri']) },
    { key: 'ua', header: 'User agent', cell: (r) => r['UserAgent'] || '—' }, { key: 'r', header: 'RTT', align: 'right', cell: (r) => (r['RoundtripUsec'] ? `${Math.round(Number(r['RoundtripUsec']) / 1000)} ms` : '—') },
    { key: 's', header: 'Status', cell: (r) => state(r['Status']) },
  ] },
  registrations: { label: 'Registrations', columns: [
    { key: 'n', header: 'Registration', cell: (r) => mono(r['ObjectName']) }, { key: 'u', header: 'Server URI', cell: (r) => mono(r['ServerUri']) },
    { key: 'c', header: 'Client URI', cell: (r) => mono(r['ClientUri']) }, { key: 'e', header: 'Expires', align: 'right', cell: (r) => r['NextReg'] ?? r['Expiration'] ?? '—' },
    { key: 's', header: 'Status', cell: (r) => state(r['Status']) },
  ] },
  transports: { label: 'Transports', columns: [
    { key: 'n', header: 'Transport', cell: (r) => mono(r['ObjectName']) }, { key: 'p', header: 'Protocol', cell: (r) => (r['Protocol'] ?? '').toUpperCase() }, { key: 'b', header: 'Bind', cell: (r) => mono(r['Bind']) },
    { key: 'x', header: 'External', cell: (r) => mono(r['ExternalSignalingAddress']) },
  ] },
};

export default function SipStatusPage() {
  const { serverId } = useServer();
  const [tab, setTab] = useState<keyof typeof VIEWS>('endpoints');
  const q = useQuery({ queryKey: ['asterisk', 'live', tab, serverId], queryFn: () => asteriskApi.live(tab, serverId!), enabled: Boolean(serverId), refetchInterval: 20_000 });
  if (!serverId) return <EmptyState title="No Asterisk server registered" />;
  return (
    <div className="space-y-4">
      <PageHeader title="SIP Status" description="Live PJSIP state reported by Asterisk (AMI)." actions={<Button size="sm" loading={q.isFetching} onClick={() => q.refetch()}>Refresh</Button>} />
      <Tabs value={tab} onChange={setTab} items={(Object.keys(VIEWS) as Array<keyof typeof VIEWS>).map((k) => ({ value: k, label: VIEWS[k].label }))} />
      <Card bodyClassName="p-0">
        <DataTable<Row> rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => `${r['ObjectName'] ?? ''}${r['Uri'] ?? ''}${r['Aor'] ?? ''}`} dense
          empty={{ title: `No ${VIEWS[tab].label.toLowerCase()} reported by Asterisk`, description: 'Objects appear here after the configuration is applied and Asterisk loads them.' }} columns={VIEWS[tab].columns} />
      </Card>
    </div>
  );
}
