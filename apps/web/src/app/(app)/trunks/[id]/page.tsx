'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PhoneCall, TestTube2 } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { trunkApi } from '@/lib/api/trunks';
import { asteriskApi } from '@/lib/api/asterisk';
import { errorMessage } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList, Field, Input } from '@/components/ui/primitives';
import { EmptyState, ErrorState, InlineAlert, LoadingState, StatusText } from '@/components/ui/feedback';
import { TestResults } from '@/components/domain/trunk-test';

export default function TrunkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { serverId } = useServer();
  const trunks = useQuery({ queryKey: ['trunks'], queryFn: trunkApi.list });
  const t = trunks.data?.find((x) => x.id === id);
  const [number, setNumber] = useState('');
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const test = useMutation({ mutationFn: (withCall: boolean) => trunkApi.test(id, withCall ? number : undefined), onSuccess: () => setLastRun(new Date()) });
  const sip = useQuery({
    queryKey: ['cli', 'pjsip show endpoint', t?.name, serverId], enabled: Boolean(t && serverId && can(P.CLI_ACCESS)),
    queryFn: () => asteriskApi.cli(serverId!, `pjsip show endpoint ${t!.name}`),
  });

  if (trunks.isLoading) return <LoadingState />;
  if (trunks.error) return <ErrorState error={trunks.error} onRetry={() => trunks.refetch()} />;
  if (!t) return <EmptyState title="Trunk not found" />;

  return (
    <div className="space-y-4">
      <PageHeader title={`Trunk ${t.name}`} breadcrumbs={[{ label: 'SIP Trunks', href: '/trunks' }, { label: t.name }]} description={t.pbx ? `${t.pbx.name} · ${t.pbx.vendor}` : undefined} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Configuration">
          <DefinitionList columns={1} items={[
            ['Status', t.enabled ? <StatusText key="s" status={t.status} /> : <StatusText key="s" status="DISABLED" />],
            ['Remote', `${t.host}:${t.port} (${t.protocol.toUpperCase()})`],
            ['Transport', t.transportName],
            ['Authentication', t.authMode === 'USERPASS' ? `Username ${t.username ?? ''} · password ${t.hasPassword ? 'stored (encrypted)' : 'not set'}` : t.authMode],
            ['Registration', t.sipMode],
            ['Inbound context', t.inboundContext],
            ['Identify networks', [t.host, ...t.matchNetworks].join(', ')],
            ['Qualify frequency', t.qualifyFrequency ? `${t.qualifyFrequency}s` : 'Disabled'],
          ]} />
        </Card>
        <Card title="Connectivity test" className="xl:col-span-2" actions={lastRun && <span className="text-[12px] text-muted">Last run {fmtDateTime(lastRun)}</span>}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="primary" icon={<TestTube2 className="size-3.5" />} loading={test.isPending && !test.variables} disabled={!can(P.TRUNKS_CONFIGURE)} onClick={() => test.mutate(false)}>Run test</Button>
              <Field label="Optional test call to" className="w-56">{(fid) => <Input id={fid} className="font-mono" value={number} onChange={(e) => setNumber(e.target.value.replace(/[^0-9*#+]/g, ''))} placeholder="number" />}</Field>
              <Button icon={<PhoneCall className="size-3.5" />} disabled={!number || !can(P.TRUNKS_CONFIGURE)} loading={test.isPending && Boolean(test.variables)} onClick={() => test.mutate(true)}>Test with call</Button>
            </div>
            {!can(P.TRUNKS_CONFIGURE) && <InlineAlert tone="info">Running tests requires the trunks.configure permission.</InlineAlert>}
            {test.error && <InlineAlert tone="crit">{errorMessage(test.error)}</InlineAlert>}
            {test.data ? (
              <>
                <InlineAlert tone={test.data.ok ? 'ok' : 'crit'} title={test.data.ok ? 'All checks passed' : 'One or more checks failed'} />
                <TestResults results={test.data.results} />
              </>
            ) : t.lastRttMs !== null ? <p className="text-[13px] text-muted">Last measured RTT {t.lastRttMs} ms.</p> : <p className="text-[13px] text-muted">Runs DNS, {t.protocol.toUpperCase()} reachability, PJSIP endpoint, SIP OPTIONS (qualify) and an optional test call through the connector.</p>}
          </div>
        </Card>
      </div>
      {can(P.CLI_ACCESS) && (
        <Card title="Live SIP status (pjsip show endpoint)" actions={<Button size="sm" onClick={() => sip.refetch()} loading={sip.isFetching}>Refresh</Button>}>
          {sip.isLoading ? <LoadingState /> : sip.error ? <InlineAlert tone="crit">{errorMessage(sip.error)}</InlineAlert> : <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[12px]">{sip.data?.output || 'No output'}</pre>}
        </Card>
      )}
    </div>
  );
}
