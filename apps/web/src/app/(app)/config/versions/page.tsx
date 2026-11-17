'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileClock, FileDiff } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { configApi } from '@/lib/api/config';
import type { ApplyResult, ConfigVersion } from '@/lib/api/types';
import { PermissionGuard } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { fmtDateTime } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList, Tabs } from '@/components/ui/primitives';
import { Dialog, EmptyState, ErrorState, LoadingState, StatusText } from '@/components/ui/feedback';
import { ApplyPanel, ApplyResultView } from '@/components/domain/apply-panel';
import { RollbackButton } from '@/components/domain/version-actions';

function VersionView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['config', 'version', id], queryFn: () => configApi.version(id) });
  const [tab, setTab] = useState<'objects' | 'dialplan' | 'transports'>('objects');
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data!;
  return (
    <div className="space-y-3">
      <DefinitionList columns={3} items={[['Version', `v${v.version}`], ['Status', <StatusText key="s" status={v.status} />], ['Changed by', v.changedBy?.displayName ?? 'System'], ['Created', fmtDateTime(v.createdAt)], ['Applied', fmtDateTime(v.appliedAt)], ['Summary', v.summary ?? '—']]} />
      {v.error && <pre className="overflow-auto rounded-md bg-crit-soft p-2 font-mono text-[12px] text-crit">{v.error}</pre>}
      <Tabs value={tab} onChange={setTab} items={[{ value: 'objects', label: 'PJSIP objects' }, { value: 'dialplan', label: 'Dialplan' }, { value: 'transports', label: 'Transports' }]} />
      {tab === 'objects' && Object.entries(v.snapshot.tables ?? {}).map(([table, rows]) => rows.length > 0 && (
        <div key={table}>
          <p className="mb-1 font-mono text-[12px] text-muted">{table} ({rows.length})</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11.5px]">
            {rows.map((r) => [`[${r['id']}]`, ...Object.entries(r).filter(([k, val]) => k !== 'id' && val !== null).map(([k, val]) => `${k}=${val}`)].join('\n')).join('\n\n')}
          </pre>
        </div>
      ))}
      {tab === 'dialplan' && <pre className="max-h-[55vh] overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11.5px]">{v.snapshot.dialplan}</pre>}
      {tab === 'transports' && <pre className="max-h-[55vh] overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11.5px]">{v.snapshot.transports}</pre>}
      <p className="text-[12px] text-muted">Secrets (auth passwords) are stored encrypted with the version and are never sent to the browser.</p>
    </div>
  );
}

export default function VersionsPage() {
  const { serverId } = useServer();
  const q = useQuery({ queryKey: ['config', 'versions', serverId], queryFn: () => configApi.versions(serverId!), enabled: Boolean(serverId) });
  const [view, setView] = useState<string | null>(null);
  const [lastRollback, setLastRollback] = useState<ApplyResult | null>(null);
  if (!serverId) return <EmptyState title="No Asterisk server registered" />;
  const versions = q.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Configuration Versions" description="Every apply creates a version with a full snapshot. Compare versions or roll back transactionally."
        actions={<Link href="/config/compare"><Button icon={<FileDiff className="size-3.5" />}>Compare versions</Button></Link>} />
      <PermissionGuard any={[P.TRUNKS_CONFIGURE, P.ENDPOINTS_CONFIGURE, P.ROUTES_CONFIGURE, P.DIALPLAN_CONFIGURE]}><ApplyPanel serverId={serverId} /></PermissionGuard>
      {lastRollback && <ApplyResultView result={lastRollback} />}
      <Card bodyClassName="p-0">
        <DataTable<ConfigVersion> rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(v) => v.id}
          empty={{ icon: FileClock, title: 'No configuration versions', description: 'A version is created the first time configuration is applied to Asterisk.' }}
          columns={[
            { key: 'v', header: 'Version', sort: (v) => v.version, cell: (v) => <span className="font-mono font-medium">v{v.version}</span> },
            { key: 'by', header: 'Created by', cell: (v) => v.changedBy?.displayName ?? 'System' },
            { key: 'at', header: 'Created', sort: (v) => v.createdAt, cell: (v) => fmtDateTime(v.createdAt) },
            { key: 'sum', header: 'Description', cell: (v) => v.summary ?? <span className="text-muted">—</span> },
            { key: 'st', header: 'Status', cell: (v) => <StatusText status={v.status} /> },
            { key: 'ap', header: 'Applied', cell: (v) => fmtDateTime(v.appliedAt) },
            { key: 'val', header: 'Asterisk validation', cell: (v) => v.status === 'APPLIED' ? <span className="text-ok">Verified</span> : v.status === 'FAILED' ? <span className="line-clamp-2 max-w-72 text-crit" title={v.error ?? ''}>{v.error?.split('\n')[0] ?? 'Rejected'}</span> : <span className="text-muted">—</span> },
            {
              key: 'a', header: '', align: 'right', cell: (v) => {
                const prev = versions.find((x) => x.version < v.version);
                return (
                  <div className="flex justify-end gap-0.5">
                    <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setView(v.id)}>View</Button>
                    {prev && <Link href={`/config/compare?a=${prev.id}&b=${v.id}`}><Button size="sm" variant="ghost" icon={<FileDiff className="size-3.5" />}>Diff</Button></Link>}
                    <RollbackButton version={v} rollback={configApi.rollback} onDone={setLastRollback} />
                  </div>
                );
              },
            },
          ]} />
      </Card>
      <Dialog open={Boolean(view)} onClose={() => setView(null)} width="xl" title="Configuration version">{view && <VersionView id={view} />}</Dialog>
    </div>
  );
}
