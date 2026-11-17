'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, Pencil, Plus, Power, RotateCw, TestTube2, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { trunkApi } from '@/lib/api/trunks';
import { pbxApi } from '@/lib/api/pbx';
import { pjsipApi } from '@/lib/api/endpoints';
import { asteriskApi } from '@/lib/api/asterisk';
import type { Trunk } from '@/lib/api/types';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { trunkFormSchema, validate, type TrunkForm } from '@/lib/validation';
import { errorDetails } from '@/lib/api/client';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, InlineAlert, StatusBadge, StatusText, useToast } from '@/components/ui/feedback';
import { TrunkFields, emptyTrunkForm, formToTrunkInput, trunkToForm } from '@/components/domain/trunk-form';

function TrunksInner() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { serverId } = useServer();
  const [pbxFilter, setPbxFilter] = useState(params.get('pbx') ?? '');
  const trunks = useQuery({ queryKey: ['trunks'], queryFn: trunkApi.list });
  const pbxs = useQuery({ queryKey: ['pbxs'], queryFn: pbxApi.list });
  const templates = useQuery({ queryKey: ['trunk-templates'], queryFn: pbxApi.templates });
  const transports = useQuery({ queryKey: ['pjsip', 'transports', serverId], queryFn: () => pjsipApi.list('transports', serverId!), enabled: Boolean(serverId) });
  const contacts = useQuery({ queryKey: ['asterisk', 'live', 'contacts', serverId], queryFn: () => asteriskApi.live('contacts', serverId!), enabled: Boolean(serverId) && can(P.SYSTEM_VIEW), refetchInterval: 30_000 });
  const regs = useQuery({ queryKey: ['asterisk', 'live', 'registrations', serverId], queryFn: () => asteriskApi.live('registrations', serverId!), enabled: Boolean(serverId) && can(P.SYSTEM_VIEW), refetchInterval: 30_000 });

  const [edit, setEdit] = useState<{ trunk: Trunk | null; pbxId: string; form: TrunkForm } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Trunk | null>(null);
  const [reload, setReload] = useState(false);

  const rows = useMemo(() => (trunks.data ?? []).filter((t) => !pbxFilter || t.pbxId === pbxFilter), [trunks.data, pbxFilter]);

  const save = useMutation({
    mutationFn: async () => {
      const input = formToTrunkInput(edit!.form, edit!.trunk?.enabled ?? true);
      return edit!.trunk ? trunkApi.update(edit!.trunk.id, input) : trunkApi.create(edit!.pbxId, input);
    },
    onSuccess: () => { toast.success('Trunk saved as draft', 'Apply the configuration to make it live.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['trunks'] }); },
  });
  const toggle = useMutation({
    mutationFn: (t: Trunk) => trunkApi.update(t.id, formToTrunkInput(trunkToForm(t), !t.enabled)),
    onSuccess: (_, t) => { toast.success(t.enabled ? 'Trunk disabled (draft)' : 'Trunk enabled (draft)', 'Apply the configuration to take effect.'); void qc.invalidateQueries({ queryKey: ['trunks'] }); },
    onError: (e) => toast.error('Update failed', e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => trunkApi.remove(id),
    onSuccess: () => { toast.success('Trunk deleted (draft)'); setDel(null); void qc.invalidateQueries({ queryKey: ['trunks'] }); },
    onError: (e) => { toast.error('Delete failed', e); setDel(null); },
  });
  const doReload = useMutation({
    mutationFn: () => asteriskApi.reload(serverId!, 'res_pjsip.so'),
    onSuccess: (r) => { toast.success(r.ok ? 'PJSIP reloaded' : 'Reload reported a problem', r.output); setReload(false); },
    onError: (e) => { toast.error('Reload failed', e); setReload(false); },
  });

  function submit() {
    const r = validate(trunkFormSchema, edit!.form);
    setErrors(r.ok ? {} : r.errors);
    if (r.ok) save.mutate();
  }

  const contactStatus = (t: Trunk) => contacts.data?.find((c) => c['Aor'] === t.name);
  const regStatus = (t: Trunk) => regs.data?.find((r) => r['ObjectName'] === `${t.name}-reg`);
  const pbxName = (id: string) => pbxs.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <>
      <PageHeader title="SIP Trunks" description="Trunks between PBXs and Asterisk. Changes are drafts until applied."
        actions={<>
          <Select aria-label="Filter by PBX" className="w-52" value={pbxFilter} onChange={(e) => setPbxFilter(e.target.value)}>
            <option value="">All PBXs</option>
            {pbxs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <PermissionGuard all={[P.SYSTEM_MANAGE, P.CLI_UNSAFE]}><Button icon={<RotateCw className="size-3.5" />} onClick={() => setReload(true)} disabled={!serverId}>Reload PJSIP</Button></PermissionGuard>
          <PermissionGuard all={[P.TRUNKS_CONFIGURE]}>
            <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!pbxs.data?.length}
              onClick={() => { setErrors({}); setEdit({ trunk: null, pbxId: pbxFilter || pbxs.data![0]!.id, form: emptyTrunkForm({ transportName: transports.data?.[0]?.name ?? '' }) }); }}>Add trunk</Button>
          </PermissionGuard>
        </>} />
      <Card bodyClassName="p-0">
        <DataTable<Trunk>
          rows={rows} loading={trunks.isLoading} error={trunks.error} onRetry={() => trunks.refetch()} rowKey={(r) => r.id}
          empty={{ icon: Cable, title: 'No SIP trunks configured', description: 'Add a trunk to an existing PBX, or use the guided PBX setup.', action: <Link href="/pbx/new"><Button icon={<Plus className="size-3.5" />}>Configure PBX</Button></Link> }}
          columns={[
            { key: 'name', header: 'Trunk', sort: (r) => r.name, cell: (r) => <Link className="font-medium text-primary hover:underline" href={`/trunks/${r.id}`}>{r.name}</Link> },
            { key: 'pbx', header: 'PBX', sort: (r) => r.pbx?.name ?? pbxName(r.pbxId), cell: (r) => r.pbx?.name ?? pbxName(r.pbxId) },
            { key: 'remote', header: 'Remote', cell: (r) => <span className="font-mono text-[12.5px]">{r.host}:{r.port}</span> },
            { key: 'local', header: 'Local transport', cell: (r) => <span className="font-mono text-[12.5px]">{r.transportName}</span> },
            { key: 'proto', header: 'Protocol', cell: (r) => r.protocol.toUpperCase() },
            { key: 'auth', header: 'Auth', cell: (r) => (r.authMode === 'USERPASS' ? 'User/pass' : r.authMode === 'IP' ? 'IP-based' : 'None') },
            { key: 'reg', header: 'Registration', cell: (r) => (r.sipMode === 'PEER' ? <span className="text-muted">n/a</span> : r.sipMode === 'ACCEPT_REGISTRATION' ? <span className="text-text-2">Inbound</span> : <StatusText status={regStatus(r)?.['Status'] ?? 'UNKNOWN'} />) },
            {
              key: 'qual', header: 'Qualify', cell: (r) => {
                const c = contactStatus(r);
                if (!c) return <StatusText status={r.qualifyFrequency ? 'UNKNOWN' : null} />;
                const st = c['Status'] ?? 'Unknown';
                return <StatusBadge tone={/Reachable|Avail/i.test(st) ? 'ok' : /Unreach|Unavail/i.test(st) ? 'crit' : 'neutral'}>{st}{c['RoundtripUsec'] ? ` · ${Math.round(Number(c['RoundtripUsec']) / 1000)} ms` : ''}</StatusBadge>;
              },
            },
            { key: 'status', header: 'Status', cell: (r) => (r.enabled ? <StatusText status={r.status} /> : <StatusText status="DISABLED" />) },
            {
              key: 'act', header: '', align: 'right', cell: (r) => (
                <div className="flex justify-end gap-0.5">
                  <Link href={`/trunks/${r.id}`}><Button size="sm" variant="ghost" icon={<TestTube2 className="size-3.5" />}>Test</Button></Link>
                  <PermissionGuard all={[P.TRUNKS_CONFIGURE]}>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} icon={<Pencil className="size-3.5" />} onClick={() => { setErrors({}); setEdit({ trunk: r, pbxId: r.pbxId, form: trunkToForm(r) }); }} />
                    <Button size="sm" variant="ghost" aria-label={r.enabled ? `Disable ${r.name}` : `Enable ${r.name}`} icon={<Power className="size-3.5" />} loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate(r)} />
                    <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(r)} />
                  </PermissionGuard>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} width="xl" title={edit?.trunk ? `Edit trunk ${edit.trunk.name}` : 'Add trunk'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save draft</Button></>}>
        {edit && (
          <div className="space-y-3">
            {!edit.trunk && (
              <Select aria-label="PBX" value={edit.pbxId} onChange={(e) => setEdit({ ...edit, pbxId: e.target.value })}>
                {pbxs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
            {save.error && <InlineAlert tone="crit" title="Could not save">{(save.error as Error).message}{errorDetails(save.error).map((d, i) => <div key={i}>{d.field ?? d.path} {d.message}</div>)}</InlineAlert>}
            <TrunkFields value={edit.form} onChange={(form) => setEdit({ ...edit, form })} errors={errors} templates={templates.data ?? []} transports={(transports.data ?? []).map((t) => t.name)} />
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={Boolean(del)} danger title="Delete trunk?" confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} requireText={del?.name}>
        <p>Removes the trunk and its generated endpoint, AOR, auth, identify and registration from the draft. Routes using it as egress must be changed first.</p>
      </ConfirmDialog>
      <ConfirmDialog open={reload} title="Reload res_pjsip?" confirmLabel="Reload" loading={doReload.isPending} onCancel={() => setReload(false)} onConfirm={() => doReload.mutate()}>
        <p>Reloads PJSIP on the selected Asterisk server. Active calls are not dropped. To publish draft changes use <Link className="text-primary underline" href="/config/versions">Apply configuration</Link> instead.</p>
      </ConfirmDialog>
    </>
  );
}

export default function TrunksPage() {
  return <Suspense><TrunksInner /></Suspense>;
}
