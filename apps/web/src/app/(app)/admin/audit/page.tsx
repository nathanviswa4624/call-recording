'use client';
import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ClipboardList, Search } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { auditApi, userApi, type AuditFilters } from '@/lib/api/audit';
import type { AuditEntry } from '@/lib/api/types';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { fmtDateTime, toLocalInput } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList, Field, Input, Select } from '@/components/ui/primitives';
import { Dialog, EmptyState, StatusBadge } from '@/components/ui/feedback';

const PAGE = 100;

export default function AuditPage() {
  return <PermissionGuard all={[P.AUDIT_VIEW]} fallback={<EmptyState title="Not permitted" />}><AuditInner /></PermissionGuard>;
}

/** Read-only by design: audit records are append-only (DB trigger) and the UI offers no edit/delete. */
function AuditInner() {
  const { can } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: userApi.list, enabled: can(P.USERS_MANAGE) });
  const [draft, setDraft] = useState<AuditFilters>({});
  const [f, setF] = useState<AuditFilters>({});
  const [view, setView] = useState<AuditEntry | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit', f],
    queryFn: ({ pageParam }) => auditApi.list({ ...f, limit: PAGE, before: pageParam ?? f.to }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]!.createdAt : null),
  });
  const rows = q.data?.pages.flat();
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Logs" description="Append-only record of every sign-in, configuration change, CLI command and recording access." />
      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3" onSubmit={(e) => { e.preventDefault(); setF(draft); }}>
        {users.data && <Field label="User" className="w-48">{(id) => <Select id={id} value={draft.userId ?? ''} onChange={(e) => setDraft({ ...draft, userId: e.target.value || undefined })}><option value="">Any</option>{users.data.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select>}</Field>}
        <Field label="Action starts with" className="w-48">{(id) => <Input id={id} value={draft.action ?? ''} onChange={(e) => setDraft({ ...draft, action: e.target.value || undefined })} placeholder="config.apply" />}</Field>
        <Field label="Resource type" className="w-44">{(id) => <Input id={id} value={draft.objectType ?? ''} onChange={(e) => setDraft({ ...draft, objectType: e.target.value || undefined })} placeholder="sip_trunk" />}</Field>
        <Field label="IP address" className="w-40">{(id) => <Input id={id} value={draft.ip ?? ''} onChange={(e) => setDraft({ ...draft, ip: e.target.value || undefined })} />}</Field>
        <Field label="From">{(id) => <Input id={id} type="datetime-local" value={draft.from ? toLocalInput(new Date(draft.from)) : ''} onChange={(e) => setDraft({ ...draft, from: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="datetime-local" value={draft.to ? toLocalInput(new Date(draft.to)) : ''} onChange={(e) => setDraft({ ...draft, to: e.target.value ? new Date(e.target.value).toISOString() : undefined })} />}</Field>
        <Button type="submit" variant="primary" icon={<Search className="size-3.5" />}>Filter</Button>
      </form>
      <Card bodyClassName="p-0">
        <DataTable<AuditEntry> rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.id} dense onRowClick={setView}
          hasMore={q.hasNextPage} loadingMore={q.isFetchingNextPage} onLoadMore={() => q.fetchNextPage()}
          empty={{ icon: ClipboardList, title: 'No audit records' }}
          columns={[
            { key: 't', header: 'Timestamp', cell: (r) => <span className="tabular whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
            { key: 'u', header: 'User', cell: (r) => r.user?.displayName ?? <span className="text-muted">System</span> },
            { key: 'a', header: 'Action', cell: (r) => <span className="font-mono text-[12.5px]">{r.action}</span> },
            { key: 'o', header: 'Resource', cell: (r) => r.objectType ? <span>{r.objectType}{r.objectLabel ? <span className="text-text-2"> · {r.objectLabel}</span> : null}</span> : '—' },
            { key: 'r', header: 'Result', cell: (r) => <StatusBadge tone={r.result === 'SUCCESS' ? 'ok' : 'crit'}>{r.result === 'SUCCESS' ? 'Success' : 'Failure'}</StatusBadge> },
            { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-[12px]">{r.ip ?? '—'}</span> },
            { key: 'e', header: 'Details', cell: (r) => <span className="line-clamp-1 max-w-80 text-text-2">{r.error ?? (r.newValue ? JSON.stringify(r.newValue).slice(0, 80) : '')}</span> },
          ]} />
      </Card>
      <Dialog open={Boolean(view)} onClose={() => setView(null)} width="lg" title="Audit record">
        {view && <div className="space-y-3">
          <DefinitionList columns={2} items={[['Timestamp', fmtDateTime(view.createdAt)], ['User', view.user ? `${view.user.displayName} (${view.user.username})` : 'System'], ['Action', view.action], ['Result', view.result], ['Resource', `${view.objectType ?? '—'} ${view.objectId ?? ''}`], ['Label', view.objectLabel], ['IP', view.ip], ['Request ID', view.requestId], ['User agent', view.userAgent]]} />
          {view.error && <div><p className="text-[11px] text-muted uppercase">Error</p><pre className="overflow-auto rounded bg-crit-soft p-2 text-[12px] text-crit">{view.error}</pre></div>}
          {view.oldValue != null && <div><p className="text-[11px] text-muted uppercase">Old value</p><pre className="max-h-60 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11.5px]">{JSON.stringify(view.oldValue, null, 2)}</pre></div>}
          {view.newValue != null && <div><p className="text-[11px] text-muted uppercase">New value</p><pre className="max-h-60 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11.5px]">{JSON.stringify(view.newValue, null, 2)}</pre></div>}
          <p className="text-[12px] text-muted">Secret values are masked before they are written to the audit log.</p>
        </div>}
      </Dialog>
    </div>
  );
}
