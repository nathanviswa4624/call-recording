'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, Pencil, Plus, Route as RouteIcon, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { routeApi } from '@/lib/api/routes';
import { pbxApi } from '@/lib/api/pbx';
import { trunkApi } from '@/lib/api/trunks';
import { errorDetails } from '@/lib/api/client';
import type { Route } from '@/lib/api/types';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { routeFormSchema, validate, type RouteForm } from '@/lib/validation';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, EmptyState, InlineAlert, StatusBadge, useToast } from '@/components/ui/feedback';
import { RouteEditor, emptyRouteForm, formToRouteInput, matchingOrder, routeToForm } from '@/components/domain/route-editor';
import { ApplyPanel } from '@/components/domain/apply-panel';

export default function RoutesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { serverId } = useServer();
  const routes = useQuery({ queryKey: ['routes'], queryFn: routeApi.list });
  const pbxs = useQuery({ queryKey: ['pbxs'], queryFn: pbxApi.list });
  const trunks = useQuery({ queryKey: ['trunks'], queryFn: trunkApi.list });
  const callTypes = useQuery({ queryKey: ['call-types'], queryFn: routeApi.callTypes });
  const policies = useQuery({ queryKey: ['recording-policies'], queryFn: routeApi.policies });
  const [pbxFilter, setPbxFilter] = useState('');
  const [edit, setEdit] = useState<{ route: Route | null; form: RouteForm } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Route | null>(null);
  const [orderFor, setOrderFor] = useState<string | null>(null);

  const rows = useMemo(() => (routes.data ?? []).filter((r) => !pbxFilter || r.pbxId === pbxFilter), [routes.data, pbxFilter]);
  const save = useMutation({
    mutationFn: () => {
      const input = formToRouteInput(edit!.form, edit!.route?.routeNumber);
      return edit!.route ? routeApi.update(edit!.route.id, input) : routeApi.create(input);
    },
    onSuccess: (r) => {
      toast.success('Route saved as draft', r.warnings?.length ? r.warnings.join(' · ') : 'Apply the configuration to update the dialplan.');
      setEdit(null); void qc.invalidateQueries({ queryKey: ['routes'] }); void qc.invalidateQueries({ queryKey: ['route-patterns'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => routeApi.remove(id),
    onSuccess: () => { toast.success('Route deleted (draft)'); setDel(null); void qc.invalidateQueries({ queryKey: ['routes'] }); },
    onError: (e) => { toast.error('Delete failed', e); setDel(null); },
  });
  const submit = () => {
    const r = validate(routeFormSchema, edit!.form);
    setErrors(r.ok ? {} : r.errors);
    if (r.ok) save.mutate();
  };
  const order = orderFor ? matchingOrder((routes.data ?? []).filter((r) => r.pbxId === orderFor)) : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Routes & Groups" description="A route groups one or more patterns with a destination, priority, call type and recording policy."
        actions={<>
          <Select aria-label="Filter by PBX" className="w-52" value={pbxFilter} onChange={(e) => setPbxFilter(e.target.value)}>
            <option value="">All PBXs</option>{pbxs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button icon={<ListOrdered className="size-3.5" />} disabled={!pbxFilter && !pbxs.data?.length} onClick={() => setOrderFor(pbxFilter || pbxs.data![0]!.id)}>Matching order</Button>
          <PermissionGuard all={[P.ROUTES_CONFIGURE]}>
            <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!pbxs.data?.length} onClick={() => { setErrors({}); save.reset(); setEdit({ route: null, form: emptyRouteForm(pbxFilter || pbxs.data?.[0]?.id) }); }}>Create route</Button>
          </PermissionGuard>
        </>} />
      <Card bodyClassName="p-0">
        <DataTable<Route> rows={rows} loading={routes.isLoading} error={routes.error} onRetry={() => routes.refetch()} rowKey={(r) => r.id}
          empty={{ icon: RouteIcon, title: 'No route patterns configured', description: pbxs.data?.length ? 'Create a route to decide where calls go and how they are recorded.' : 'Configure a PBX first.' }}
          columns={[
            { key: 'n', header: '#', align: 'right', sort: (r) => r.routeNumber, cell: (r) => r.routeNumber },
            { key: 'name', header: 'Route', sort: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'pbx', header: 'PBX', cell: (r) => r.pbx?.name ?? '—' },
            { key: 'pat', header: 'Patterns', cell: (r) => <div className="flex flex-wrap gap-1">{r.patterns.map((p) => <code key={p.id} className={`rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] ${p.enabled ? '' : 'line-through opacity-60'}`}>{p.prefix ? <span className="text-primary">{p.prefix}</span> : null}{p.pattern}</code>)}</div> },
            { key: 'prio', header: 'Priority', align: 'right', sort: (r) => r.priority, cell: (r) => r.priority },
            { key: 'dir', header: 'Direction', cell: (r) => r.direction.toLowerCase() },
            { key: 'dest', header: 'Destination', cell: (r) => (r.egressKind === 'TRUNK' ? r.egressTrunk?.name ?? '—' : r.egressKind === 'CONTEXT' ? <span className="font-mono">{r.egressContext}</span> : 'Reject') },
            { key: 'ct', header: 'Call type', cell: (r) => r.callType?.name ?? <span className="text-muted">Auto</span> },
            { key: 'rec', header: 'Recording', cell: (r) => r.recordingPolicy ? <StatusBadge tone={r.recordingPolicy.mode === 'NEVER' ? 'neutral' : 'ok'} icon={false}>{r.recordingPolicy.name}</StatusBadge> : <span className="text-muted">Inherit</span> },
            { key: 'en', header: 'Status', cell: (r) => (r.enabled ? <StatusBadge tone="ok">Enabled</StatusBadge> : <StatusBadge tone="neutral">Disabled</StatusBadge>) },
            {
              key: 'act', header: '', align: 'right', cell: (r) => can(P.ROUTES_CONFIGURE) ? (
                <div className="flex justify-end gap-0.5">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} icon={<Pencil className="size-3.5" />} onClick={() => { setErrors({}); save.reset(); setEdit({ route: r, form: routeToForm(r) }); }} />
                  <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(r)} />
                </div>
              ) : null,
            },
          ]} />
      </Card>
      {serverId && <PermissionGuard all={[P.ROUTES_CONFIGURE]}><ApplyPanel serverId={serverId} /></PermissionGuard>}

      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} width="xl" title={edit?.route ? `Edit route #${edit.route.routeNumber}` : 'Create route'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save draft</Button></>}>
        {edit && (
          <div className="space-y-3">
            {save.error && <InlineAlert tone="crit" title="Could not save">{(save.error as Error).message}{errorDetails(save.error).map((d, i) => <div key={i}>{d.path} {d.message}</div>)}</InlineAlert>}
            <RouteEditor value={edit.form} onChange={(form) => setEdit({ ...edit, form })} errors={errors} pbxs={pbxs.data ?? []} trunks={trunks.data ?? []} callTypes={callTypes.data ?? []} policies={policies.data ?? []} />
          </div>
        )}
      </Dialog>
      <Dialog open={Boolean(orderFor)} onClose={() => setOrderFor(null)} width="lg" title="Route matching order">
        <div className="space-y-3">
          <Select aria-label="PBX" value={orderFor ?? ''} onChange={(e) => setOrderFor(e.target.value)}>{pbxs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <p className="text-[12.5px] text-muted">Asterisk checks priority tiers in order (ordered <code>include</code>s), and within a tier picks the most specific pattern. The first row that matches a dialled number wins.</p>
          {order.length === 0 ? <EmptyState title="No enabled patterns for this PBX" /> : (
            <ol className="divide-y divide-border rounded-md border border-border">
              {order.map((o, i) => (
                <li key={o.pattern.id} className="grid grid-cols-[2rem_6rem_1fr_1fr] items-center gap-2 px-3 py-1.5 text-[13px]">
                  <span className="text-muted tabular">{i + 1}</span>
                  <span className="text-text-2">prio {o.route.priority}</span>
                  <code className="font-mono">{o.full}</code>
                  <span className="truncate">{o.route.name}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Dialog>
      <ConfirmDialog open={Boolean(del)} danger title="Delete route?" confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)}>
        <p>Deletes route <span className="font-medium text-text">{del?.name}</span> and its patterns from the draft. Historical calls are kept; their link to this route is cleared.</p>
      </ConfirmDialog>
    </div>
  );
}
