'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileCode2, Pencil, Plus, Power, TestTube2, Trash2, Waypoints } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { KIND_OBJECT, pjsipApi, renderIni } from '@/lib/api/endpoints';
import { asteriskApi } from '@/lib/api/asterisk';
import { errorDetails, errorMessage } from '@/lib/api/client';
import type { Params, PjsipKind, PjsipObject } from '@/lib/api/types';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { DataTable, PageHeader, type Column } from '@/components/ui/data';
import { Button, Card, Checkbox, Field, Input, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, EmptyState, InlineAlert, LoadingState, StatusBadge, useToast } from '@/components/ui/feedback';
import { ParamsEditor } from '@/components/domain/params-editor';
import { ApplyPanel } from '@/components/domain/apply-panel';

const TITLES: Record<PjsipKind, { title: string; description: string; noun: string }> = {
  endpoints: { title: 'PJSIP Endpoints', description: 'SIP peers Asterisk talks to (trunks generate theirs automatically).', noun: 'endpoint' },
  aors: { title: 'AORs', description: 'Addresses of record: where endpoints are reached and qualified.', noun: 'AOR' },
  auths: { title: 'Authentication', description: 'Credentials for inbound and outbound authentication. Stored secrets are never shown.', noun: 'auth' },
  identifies: { title: 'Identify Rules', description: 'Map source IPs, networks or headers to endpoints.', noun: 'identify rule' },
  transports: { title: 'Transports', description: 'UDP/TCP/TLS listeners. Changes take effect after an Asterisk restart.', noun: 'transport' },
  registrations: { title: 'Registrations', description: 'Outbound registrations from Asterisk to a PBX or provider.', noun: 'registration' },
};
const KINDS = Object.keys(TITLES) as PjsipKind[];

interface Draft {
  id?: string; name: string; params: Params; enabled: boolean; endpointName: string;
  authType: string; username: string; secret: string; realm: string; hasSecret: boolean;
  protocol: 'udp' | 'tcp' | 'tls' | 'ws' | 'wss'; bindAddress: string; bindPort: number;
}
const blank = (): Draft => ({ name: '', params: {}, enabled: true, endpointName: '', authType: 'userpass', username: '', secret: '', realm: '', hasSecret: false, protocol: 'udp', bindAddress: '0.0.0.0', bindPort: 5060 });
function fromObject(o: PjsipObject): Draft {
  return { ...blank(), id: o.id, name: o.name, params: { ...o.params }, enabled: o.enabled ?? true, endpointName: o.endpointName ?? '', authType: o.authType ?? 'userpass', username: o.username ?? '', realm: o.realm ?? '', hasSecret: Boolean(o.hasSecret), protocol: (o.protocol ?? 'udp'), bindAddress: o.bindAddress ?? '0.0.0.0', bindPort: o.bindPort ?? 5060 };
}

function body(kind: PjsipKind, d: Draft, serverId?: string): Record<string, unknown> {
  const base: Record<string, unknown> = serverId ? { serverId } : {};
  const params = Object.fromEntries(Object.entries(d.params).filter(([, v]) => v !== '' && v !== undefined));
  switch (kind) {
    case 'auths': return { ...base, name: d.name, authType: d.authType, username: d.username || null, realm: d.realm || null, params, ...(d.secret ? { secret: d.secret } : {}) };
    case 'transports': return { ...base, name: d.name, protocol: d.protocol, bindAddress: d.bindAddress, bindPort: d.bindPort, params };
    case 'identifies': return { ...base, name: d.name, endpointName: d.endpointName, params };
    case 'endpoints': return { ...base, name: d.name, params, enabled: d.enabled };
    default: return { ...base, name: d.name, params };
  }
}

export default function PjsipPage() {
  const { kind } = useParams<{ kind: string }>();
  if (!KINDS.includes(kind as PjsipKind)) return <EmptyState title="Unknown object type" />;
  return <PjsipManager kind={kind as PjsipKind} />;
}

function PjsipManager({ kind }: { kind: PjsipKind }) {
  const meta = TITLES[kind];
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { serverId, server } = useServer();
  const list = useQuery({ queryKey: ['pjsip', kind, serverId], queryFn: () => pjsipApi.list(kind, serverId!), enabled: Boolean(serverId) });
  const catalog = useQuery({ queryKey: ['pjsip', 'catalog', KIND_OBJECT[kind], serverId], queryFn: () => pjsipApi.catalog(KIND_OBJECT[kind], serverId!), enabled: Boolean(serverId), staleTime: 300_000 });
  const endpoints = useQuery({ queryKey: ['pjsip', 'endpoints', serverId], queryFn: () => pjsipApi.list('endpoints', serverId!), enabled: Boolean(serverId) && kind === 'identifies' });
  const live = useQuery({ queryKey: ['asterisk', 'live', 'endpoints', serverId], queryFn: () => asteriskApi.live('endpoints', serverId!), enabled: Boolean(serverId) && kind === 'endpoints' && can(P.SYSTEM_VIEW), refetchInterval: 30_000 });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState<PjsipObject | null>(null);
  const [del, setDel] = useState<PjsipObject | null>(null);
  const [testOut, setTestOut] = useState<{ name: string; output: string } | null>(null);
  const editable = can(P.ENDPOINTS_CONFIGURE);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pjsip'] });

  const save = useMutation({
    mutationFn: async () => (draft!.id ? pjsipApi.update(kind, draft!.id, body(kind, draft!)) : pjsipApi.create(kind, body(kind, draft!, serverId!))),
    onSuccess: (r) => {
      toast.success(`${meta.noun} saved as draft`, r.note ?? (r.warnings?.length ? r.warnings.map((w) => w.message).join('; ') : 'Apply the configuration to make it live.'));
      setDraft(null); void invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (o: PjsipObject) => pjsipApi.update('endpoints', o.id, { name: o.name, params: o.params, enabled: !(o.enabled ?? true) }),
    onSuccess: () => { toast.success('Endpoint updated (draft)'); void invalidate(); },
    onError: (e) => toast.error('Update failed', e),
  });
  const remove = useMutation({
    mutationFn: (o: PjsipObject) => pjsipApi.remove(kind, o.id),
    onSuccess: () => { toast.success(`${meta.noun} deleted (draft)`); setDel(null); void invalidate(); },
    onError: (e) => { toast.error('Delete failed', e); setDel(null); },
  });
  const test = useMutation({
    mutationFn: (o: PjsipObject) => asteriskApi.cli(serverId!, `pjsip show ${KIND_OBJECT[kind] === 'identify' ? 'identify' : KIND_OBJECT[kind]} ${o.name}`),
    onSuccess: (r, o) => setTestOut({ name: o.name, output: r.output }),
    onError: (e) => toast.error('Asterisk query failed', e),
  });

  const liveState = (name: string) => live.data?.find((e) => e['ObjectName'] === name)?.['DeviceState'];

  const columns = useMemo<Column<PjsipObject>[]>(() => {
    const p = (o: PjsipObject, k: string) => (o.params[k] === undefined || o.params[k] === null || o.params[k] === '' ? <span className="text-muted">—</span> : <span className="font-mono text-[12.5px]">{String(o.params[k])}</span>);
    const name: Column<PjsipObject> = { key: 'name', header: 'Name', sort: (o) => o.name, cell: (o) => <span className="font-mono font-medium">{o.name}</span> };
    const origin: Column<PjsipObject> = { key: 'origin', header: 'Source', cell: (o) => (o.origin === 'TRUNK_GENERATED' ? <StatusBadge tone="info" icon={false}>Trunk</StatusBadge> : o.origin === 'IMPORTED' ? <StatusBadge tone="neutral" icon={false}>Imported</StatusBadge> : <span className="text-text-2">Manual</span>) };
    const pending: Column<PjsipObject> = { key: 'pending', header: 'Published', cell: (o) => (o.pending ? <StatusBadge tone="warn">Pending apply</StatusBadge> : <StatusBadge tone="ok">Applied</StatusBadge>) };
    switch (kind) {
      case 'endpoints': return [name,
        { key: 'ctx', header: 'Context', cell: (o) => p(o, 'context') }, { key: 'tr', header: 'Transport', cell: (o) => p(o, 'transport') },
        { key: 'aor', header: 'AOR', cell: (o) => p(o, 'aors') }, { key: 'auth', header: 'Auth', cell: (o) => (o.params['outbound_auth'] ? p(o, 'outbound_auth') : p(o, 'auth')) },
        { key: 'codec', header: 'Codecs', cell: (o) => p(o, 'allow') }, { key: 'dm', header: 'Direct media', cell: (o) => (o.params['direct_media'] === true || o.params['direct_media'] === 'yes' ? 'yes' : o.params['direct_media'] === undefined ? '—' : 'no') },
        { key: 'live', header: 'Status', cell: (o) => (o.enabled === false ? <StatusBadge tone="crit">Disabled</StatusBadge> : liveState(o.name) ? <StatusBadge tone={/Unavailable|Invalid/i.test(liveState(o.name)!) ? 'crit' : 'ok'}>{liveState(o.name)}</StatusBadge> : <StatusBadge tone="neutral">Not loaded</StatusBadge>) },
        origin, pending];
      case 'aors': return [name, { key: 'max', header: 'Max contacts', cell: (o) => p(o, 'max_contacts') }, { key: 'q', header: 'Qualify (s)', cell: (o) => p(o, 'qualify_frequency') }, { key: 'exp', header: 'Default expiration', cell: (o) => p(o, 'default_expiration') }, { key: 'rm', header: 'Remove existing', cell: (o) => p(o, 'remove_existing') }, { key: 'c', header: 'Contact', cell: (o) => p(o, 'contact') }, origin, pending];
      case 'auths': return [name, { key: 't', header: 'Type', cell: (o) => o.authType }, { key: 'u', header: 'Username', cell: (o) => <span className="font-mono">{o.username ?? '—'}</span> }, { key: 'r', header: 'Realm', cell: (o) => o.realm ?? '—' }, { key: 's', header: 'Secret', cell: (o) => (o.hasSecret ? <StatusBadge tone="ok">Stored (encrypted)</StatusBadge> : <StatusBadge tone="warn">Not set</StatusBadge>) }, origin, pending];
      case 'identifies': return [name, { key: 'ep', header: 'Endpoint', cell: (o) => <span className="font-mono">{o.endpointName}</span> }, { key: 'm', header: 'Match', cell: (o) => p(o, 'match') }, { key: 'h', header: 'Match header', cell: (o) => p(o, 'match_header') }, { key: 'ru', header: 'Request URI', cell: (o) => p(o, 'match_request_uri') }, origin, pending];
      case 'transports': return [name, { key: 'pr', header: 'Protocol', cell: (o) => o.protocol?.toUpperCase() }, { key: 'b', header: 'Bind', cell: (o) => <span className="font-mono">{o.bindAddress}:{o.bindPort}</span> }, { key: 'ext', header: 'External address', cell: (o) => p(o, 'external_signaling_address') }, { key: 'ln', header: 'Local net', cell: (o) => p(o, 'local_net') }, { key: 'st', header: 'State', cell: (o) => (o.pending ? <StatusBadge tone="warn">Inactive until applied + restart</StatusBadge> : server?.restartRequired ? <StatusBadge tone="warn">Restart required</StatusBadge> : <StatusBadge tone="ok">Active</StatusBadge>) }];
      case 'registrations': return [name, { key: 'srv', header: 'Server URI', cell: (o) => p(o, 'server_uri') }, { key: 'cl', header: 'Client URI', cell: (o) => p(o, 'client_uri') }, { key: 'auth', header: 'Auth', cell: (o) => p(o, 'outbound_auth') }, { key: 'exp', header: 'Expiration', cell: (o) => p(o, 'expiration') }, origin, pending];
    }
  }, [kind, live.data, server?.restartRequired]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions: Column<PjsipObject> = {
    key: 'actions', header: '', align: 'right', cell: (o) => {
      const managed = Boolean(o.managedByTrunkId);
      return (
        <div className="flex justify-end gap-0.5">
          <Button size="sm" variant="ghost" aria-label={`View generated configuration for ${o.name}`} title="View generated configuration" icon={<FileCode2 className="size-3.5" />} onClick={() => setView(o)} />
          {(kind === 'endpoints' || kind === 'aors' || kind === 'transports' || kind === 'registrations' || kind === 'identifies') && can(P.CLI_ACCESS) && kind !== 'identifies' && (
            <Button size="sm" variant="ghost" aria-label={`Test ${o.name}`} title="Show live state in Asterisk" icon={<TestTube2 className="size-3.5" />} loading={test.isPending && test.variables?.id === o.id} onClick={() => test.mutate(o)} />
          )}
          {editable && <>
            <Button size="sm" variant="ghost" aria-label={`Edit ${o.name}`} icon={<Pencil className="size-3.5" />} disabled={kind === 'auths' && managed} title={kind === 'auths' && managed ? 'Change the password on the trunk' : 'Edit'} onClick={() => { save.reset(); setDraft(fromObject(o)); }} />
            <Button size="sm" variant="ghost" aria-label={`Duplicate ${o.name}`} title="Duplicate" icon={<Copy className="size-3.5" />} onClick={() => { save.reset(); setDraft({ ...fromObject(o), id: undefined, name: `${o.name}-copy`, hasSecret: false }); }} />
            {kind === 'endpoints' && <Button size="sm" variant="ghost" aria-label={o.enabled === false ? `Enable ${o.name}` : `Disable ${o.name}`} title={o.enabled === false ? 'Enable' : 'Disable'} icon={<Power className="size-3.5" />} onClick={() => toggle.mutate(o)} />}
            <Button size="sm" variant="ghost" aria-label={`Delete ${o.name}`} icon={<Trash2 className="size-3.5" />} disabled={managed} title={managed ? 'Generated by a trunk — delete the trunk instead' : 'Delete'} onClick={() => setDel(o)} />
          </>}
        </div>
      );
    },
  };

  if (!serverId) return <EmptyState title="No Asterisk server selected" />;
  const exclude = kind === 'identifies' ? ['endpoint'] : kind === 'auths' ? ['auth_type', 'username', 'password', 'realm', 'md5_cred'] : kind === 'transports' ? ['protocol', 'bind'] : [];

  return (
    <div className="space-y-4">
      <PageHeader title={meta.title} description={meta.description} actions={editable && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { save.reset(); setDraft(blank()); }}>Add {meta.noun}</Button>} />
      <Card bodyClassName="p-0">
        <DataTable<PjsipObject> rows={list.data} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} rowKey={(o) => o.id}
          empty={{ icon: Waypoints, title: `No ${meta.title.toLowerCase()} configured`, description: kind === 'transports' ? 'Create at least one transport before adding trunks.' : 'SIP trunks generate these objects automatically.', action: <Link href="/pbx/new"><Button>Configure PBX</Button></Link> }}
          columns={[...columns, actions]} />
      </Card>
      <PermissionGuard any={[P.ENDPOINTS_CONFIGURE, P.TRUNKS_CONFIGURE]}><ApplyPanel serverId={serverId} /></PermissionGuard>

      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} width="xl" title={draft?.id ? `Edit ${meta.noun} ${draft.name}` : `Add ${meta.noun}`}
        footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!draft?.name} onClick={() => save.mutate()}>Save draft</Button></>}>
        {draft && (catalog.isLoading ? <LoadingState /> : (
          <div className="space-y-3">
            {save.error && <InlineAlert tone="crit" title="Validation failed">{errorMessage(save.error)}<ul className="mt-1">{errorDetails(save.error).map((d, i) => <li key={i}><span className="font-mono">{d.field ?? d.path}</span> {d.message}</li>)}</ul></InlineAlert>}
            {kind === 'transports' && <InlineAlert tone="warn">Transport changes require an Asterisk restart after applying.</InlineAlert>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Name" required>{(id) => <Input id={id} className="font-mono" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
              {kind === 'endpoints' && <div className="flex items-end pb-1.5"><Checkbox label="Enabled" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} /></div>}
              {kind === 'identifies' && <Field label="Endpoint" required>{(id) => (
                <Select id={id} value={draft.endpointName} onChange={(e) => setDraft({ ...draft, endpointName: e.target.value })}>
                  <option value="">Select…</option>{endpoints.data?.map((e) => <option key={e.id}>{e.name}</option>)}
                </Select>
              )}</Field>}
              {kind === 'auths' && <>
                <Field label="Auth type">{(id) => <Select id={id} value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value })}><option value="userpass">userpass</option><option value="md5">md5</option><option value="google_oauth">google_oauth</option></Select>}</Field>
                <Field label="Username">{(id) => <Input id={id} autoComplete="off" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />}</Field>
                <Field label={draft.authType === 'md5' ? 'MD5 credential' : 'Password'} help={draft.hasSecret ? 'A secret is stored. Leave blank to keep it.' : 'Encrypted at rest. Never displayed after saving.'}>
                  {(id) => <Input id={id} type="password" autoComplete="new-password" value={draft.secret} placeholder={draft.hasSecret ? '•••••••• (unchanged)' : ''} onChange={(e) => setDraft({ ...draft, secret: e.target.value })} />}
                </Field>
                <Field label="Realm">{(id) => <Input id={id} value={draft.realm} onChange={(e) => setDraft({ ...draft, realm: e.target.value })} />}</Field>
              </>}
              {kind === 'transports' && <>
                <Field label="Protocol">{(id) => <Select id={id} value={draft.protocol} onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Draft['protocol'] })}>{['udp', 'tcp', 'tls', 'ws', 'wss'].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
                <Field label="Bind address">{(id) => <Input id={id} value={draft.bindAddress} onChange={(e) => setDraft({ ...draft, bindAddress: e.target.value })} />}</Field>
                <Field label="Port">{(id) => <Input id={id} type="number" value={draft.bindPort} onChange={(e) => setDraft({ ...draft, bindPort: Number(e.target.value) })} />}</Field>
              </>}
            </div>
            {catalog.data && <ParamsEditor options={catalog.data.options} value={draft.params} onChange={(params) => setDraft({ ...draft, params })} exclude={exclude}
              errors={Object.fromEntries(errorDetails(save.error).filter((d) => d.field).map((d) => [d.field!, d.message]))} />}
            {catalog.data && <p className="text-[12px] text-muted">Options for Asterisk {catalog.data.asteriskMajor}. Unsupported options are rejected by the backend before anything is applied.</p>}
          </div>
        ))}
      </Dialog>

      <Dialog open={Boolean(view)} onClose={() => setView(null)} title={`Generated configuration — ${view?.name ?? ''}`} width="lg">
        {view && (
          <div className="space-y-2">
            <p className="text-[12.5px] text-muted">{kind === 'transports' ? 'Written to pjsip_echelons_transports.conf on apply.' : `Published to the Sorcery realtime table on apply. Shown in pjsip.conf notation for readability.`}{kind === 'auths' && ' Secrets are never sent to the browser.'}</p>
            <pre className="overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[12px]">{renderIni(KIND_OBJECT[kind], view.name, view.params, kind === 'identifies' ? { endpoint: view.endpointName ?? '' } : kind === 'auths' ? { auth_type: view.authType ?? '', username: view.username ?? '', realm: view.realm ?? '', password: view.hasSecret ? '<encrypted>' : '' } : kind === 'transports' ? { protocol: view.protocol ?? '', bind: `${view.bindAddress}:${view.bindPort}` } : {})}</pre>
          </div>
        )}
      </Dialog>
      <Dialog open={Boolean(testOut)} onClose={() => setTestOut(null)} title={`Asterisk — ${testOut?.name ?? ''}`} width="xl">
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[12px]">{testOut?.output || 'No output (object not loaded — apply the configuration first)'}</pre>
      </Dialog>
      <ConfirmDialog open={Boolean(del)} danger title={`Delete ${meta.noun}?`} confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del)}>
        <p>Deletes <span className="font-mono text-text">{del?.name}</span> from the draft configuration. It is removed from Asterisk on the next apply.</p>
      </ConfirmDialog>
    </div>
  );
}
