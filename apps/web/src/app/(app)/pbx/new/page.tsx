'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Plus, Save, TestTube2, Trash2 } from 'lucide-react';
import { composeTrunkObjects, PERMISSIONS as P } from '@echelons/shared';
import { pbxApi } from '@/lib/api/pbx';
import { pjsipApi } from '@/lib/api/endpoints';
import { trunkApi } from '@/lib/api/trunks';
import { routeApi } from '@/lib/api/routes';
import { configApi } from '@/lib/api/config';
import { errorDetails, errorMessage } from '@/lib/api/client';
import type { TrunkTestResults } from '@/lib/api/types';
import { useServer } from '@/lib/server-context';
import { PermissionGuard } from '@/lib/auth';
import { VENDORS } from '@/lib/validation';
import { PageHeader } from '@/components/ui/data';
import { Button, Card, Checkbox, Field, Input, Select, Textarea, cn } from '@/components/ui/primitives';
import { EmptyState, InlineAlert, LoadingState, StatusBadge } from '@/components/ui/feedback';
import { TrunkFields, formToTrunkInput } from '@/components/domain/trunk-form';
import { PjsipGraph } from '@/components/domain/pjsip-graph';
import { ApplyPanel, IssueList } from '@/components/domain/apply-panel';
import { TestResults } from '@/components/domain/trunk-test';
import { RouteTestSummary } from '@/components/domain/route-tester';
import { WIZARD_STEPS, effectiveTransport, initialWizardState, newRoute, validateStep, type WizardRoute, type WizardState } from '@/components/domain/pbx-wizard-logic';

export default function PbxWizardPage() {
  return (
    <PermissionGuard all={[P.TRUNKS_CONFIGURE]} fallback={<EmptyState title="Not permitted" description="Configuring PBXs requires the trunks.configure permission." />}>
      <Wizard />
    </PermissionGuard>
  );
}

function Wizard() {
  const { serverId, server } = useServer();
  const sites = useQuery({ queryKey: ['sites'], queryFn: pbxApi.sites });
  const templates = useQuery({ queryKey: ['trunk-templates'], queryFn: pbxApi.templates });
  const transports = useQuery({ queryKey: ['pjsip', 'transports', serverId], queryFn: () => pjsipApi.list('transports', serverId!), enabled: Boolean(serverId) });
  const trunks = useQuery({ queryKey: ['trunks'], queryFn: trunkApi.list });
  const callTypes = useQuery({ queryKey: ['call-types'], queryFn: routeApi.callTypes });
  const policies = useQuery({ queryKey: ['recording-policies'], queryFn: routeApi.policies });
  const [s, setS] = useState<WizardState>(() => initialWizardState());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveLog, setSaveLog] = useState<Array<{ label: string; ok: boolean; message?: string }>>([]);

  useEffect(() => { if (!s.info.siteId && sites.data?.[0]) setS((x) => ({ ...x, info: { ...x.info, siteId: sites.data![0]!.id } })); }, [sites.data, s.info.siteId]);
  useEffect(() => {
    if (transports.data?.length && !s.transport.existingName) setS((x) => ({ ...x, transport: { ...x.transport, existingName: transports.data![0]!.name } }));
    if (transports.data && transports.data.length === 0) setS((x) => (x.transport.mode === 'new' ? x : { ...x, transport: { ...x.transport, mode: 'new' } }));
  }, [transports.data, s.transport.existingName]);

  const locked = Boolean(s.created.pbxId); // once drafts exist, identity fields are fixed
  const next = () => {
    const e = validateStep(step, s);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((x) => Math.min(x + 1, WIZARD_STEPS.length - 1));
  };

  // Keep trunk defaults in sync with PBX info until the user edits them.
  useEffect(() => {
    setS((x) => ({
      ...x,
      trunk: {
        ...x.trunk,
        name: x.trunk.name || (x.info.code ? `${x.info.code.toUpperCase()}-TRUNK` : ''),
        host: x.trunk.host || x.info.host,
        port: x.trunk.host ? x.trunk.port : x.info.port,
        protocol: x.trunk.host ? x.trunk.protocol : x.info.protocol,
        inboundContext: x.trunk.inboundContext || (x.info.code ? `from-${x.info.code.toLowerCase()}` : ''),
      },
    }));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    try {
      const tmpl = templates.data?.find((t) => t.id === s.trunk.templateId);
      const input = formToTrunkInput({ ...s.trunk, transportName: effectiveTransport(s) });
      return composeTrunkObjects({
        name: input.name, host: input.host, port: input.port, protocol: input.protocol, transport: input.transportName, authMode: input.authMode,
        sipMode: input.sipMode, username: input.username, password: input.password ? '********' : s.trunk.hasStoredPassword ? '********' : undefined,
        realm: input.realm, remoteDomain: input.remoteDomain, inboundContext: input.inboundContext, matchNetworks: input.matchNetworks,
        qualifyFrequency: input.qualifyFrequency, template: tmpl?.defaults, overrides: input.overrides,
      });
    } catch { return []; }
  }, [s, templates.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Select an Asterisk server first');
      const log: typeof saveLog = [];
      const created = { ...s.created, routes: { ...s.created.routes } };
      const step = async (label: string, fn: () => Promise<void>) => {
        try { await fn(); log.push({ label, ok: true }); } catch (e) {
          log.push({ label, ok: false, message: [errorMessage(e), ...errorDetails(e).map((d) => `${d.path ?? d.field ?? ''} ${d.message}`)].join(' — ') });
          throw e;
        } finally { setSaveLog([...log]); setS((x) => ({ ...x, created })); }
      };
      if (s.transport.mode === 'new' && !created.transport) {
        await step(`Transport ${s.transport.name}`, async () => {
          const params: Record<string, string> = {};
          if (s.transport.externalAddress) { params['external_signaling_address'] = s.transport.externalAddress; params['external_media_address'] = s.transport.externalAddress; }
          if (s.transport.localNet) params['local_net'] = s.transport.localNet;
          if (s.transport.protocol === 'tls') { params['cert_file'] = s.transport.certFile; params['priv_key_file'] = s.transport.privKeyFile; params['method'] = 'tlsv1_2'; }
          const t = await pjsipApi.create('transports', { serverId, name: s.transport.name, protocol: s.transport.protocol, bindAddress: s.transport.bindAddress, bindPort: s.transport.bindPort, params });
          created.transport = t.id;
        });
      }
      if (!created.pbxId) {
        await step(`PBX ${s.info.name}`, async () => {
          const p = await pbxApi.create({
            siteId: s.info.siteId, serverId, name: s.info.name, code: s.info.code, vendor: s.info.vendor,
            description: [s.info.model && `Model: ${s.info.model}`, s.info.description].filter(Boolean).join('\n') || null,
            host: s.info.host, port: s.info.port, protocol: s.info.protocol, sipMode: s.trunk.sipMode, authMode: s.trunk.authMode,
            inboundContext: s.trunk.inboundContext, enabled: true,
          });
          created.pbxId = p.id;
        });
      }
      if (!created.trunkId) {
        await step(`Trunk ${s.trunk.name}`, async () => {
          const t = await trunkApi.create(created.pbxId!, formToTrunkInput({ ...s.trunk, transportName: effectiveTransport(s) }));
          created.trunkId = t.id;
        });
      }
      for (const r of s.routes) {
        if (created.routes[r.key]) continue;
        await step(`Route ${r.name}`, async () => {
          const res = await routeApi.create({
            name: r.name, pbxId: created.pbxId!, direction: r.direction, priority: r.priority, egressKind: r.egressKind,
            egressTrunkId: r.egressKind === 'TRUNK' ? (r.egressTrunkId === 'NEW' ? created.trunkId! : r.egressTrunkId || null) : null,
            egressContext: r.egressKind === 'CONTEXT' ? r.egressContext || null : null, callTypeId: r.callTypeId || null, recordingPolicyId: r.recordingPolicyId || null,
            callerIdNumber: r.callerIdNumber || null, dialTimeout: r.dialTimeout, enabled: r.enabled,
            patterns: r.patterns.map((p) => ({ pattern: p.pattern, prefix: p.prefix || null, stripDigits: p.stripDigits, prepend: p.prepend || null, enabled: p.enabled })),
          });
          created.routes[r.key] = res.id;
        });
      }
    },
    onSuccess: () => setStep(5),
  });

  if (!serverId) return <EmptyState title="No Asterisk server" description="Register an Asterisk server (first-run setup) before adding a PBX." />;

  return (
    <div className="space-y-4">
      <PageHeader title="Add PBX" breadcrumbs={[{ label: 'PBX Systems', href: '/pbx' }, { label: 'New' }]}
        description={<>Guided setup on <span className="font-medium text-text">{server?.name}</span>. Objects are saved as drafts; nothing reaches Asterisk until you apply.</>} />
      <ol className="flex flex-wrap gap-1">
        {WIZARD_STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" disabled={i > step && !(i <= 4 && !locked)} onClick={() => i < step && setStep(i)}
              className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px]', i === step ? 'border-primary bg-primary-soft font-medium text-text' : i < step ? 'border-border bg-surface text-text-2 hover:bg-surface-3' : 'border-border bg-surface text-muted')}>
              <span className={cn('flex size-4 items-center justify-center rounded-full text-[10px]', i < step ? 'bg-ok text-white' : 'bg-surface-3')}>{i < step ? <Check className="size-2.5" /> : i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card title="1. PBX information">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="PBX name" required error={errors['name']}>{(id) => <Input id={id} disabled={locked} value={s.info.name} onChange={(e) => setS({ ...s, info: { ...s.info, name: e.target.value } })} placeholder="Avaya Aura – HQ" />}</Field>
            <Field label="Short code" required error={errors['code']} help="Used in context names and recording paths">{(id) => <Input id={id} disabled={locked} value={s.info.code} onChange={(e) => setS({ ...s, info: { ...s.info, code: e.target.value.toUpperCase() } })} placeholder="AVAYA" />}</Field>
            <Field label="Site" required error={errors['siteId']}>{(id) => (
              <Select id={id} disabled={locked} value={s.info.siteId} onChange={(e) => setS({ ...s, info: { ...s.info, siteId: e.target.value } })}>
                {sites.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}</Field>
            <Field label="Vendor" required>{(id) => (
              <Select id={id} value={s.info.vendor} onChange={(e) => {
                const vendor = e.target.value;
                const tmpl = templates.data?.find((t) => vendor.toLowerCase().startsWith(t.vendor.toLowerCase()) || t.vendor.toLowerCase().startsWith(vendor.toLowerCase().split(' ')[0]!));
                setS({ ...s, info: { ...s.info, vendor }, trunk: { ...s.trunk, templateId: tmpl?.id ?? s.trunk.templateId } });
              }}>
                {VENDORS.map((v) => <option key={v}>{v}</option>)}
              </Select>
            )}</Field>
            <Field label="Model">{(id) => <Input id={id} value={s.info.model} onChange={(e) => setS({ ...s, info: { ...s.info, model: e.target.value } })} placeholder="e.g. Aura CM 10.1" />}</Field>
            <Field label="IP address / hostname" required error={errors['host']}>{(id) => <Input id={id} value={s.info.host} onChange={(e) => setS({ ...s, info: { ...s.info, host: e.target.value.trim() } })} placeholder="192.168.51.10" />}</Field>
            <Field label="SIP port" required error={errors['port']}>{(id) => <Input id={id} type="number" value={s.info.port} onChange={(e) => setS({ ...s, info: { ...s.info, port: Number(e.target.value) } })} />}</Field>
            <Field label="Transport protocol">{(id) => (
              <Select id={id} value={s.info.protocol} onChange={(e) => setS({ ...s, info: { ...s.info, protocol: e.target.value as 'udp' | 'tcp' | 'tls' } })}>
                <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
              </Select>
            )}</Field>
            <Field label="Description" className="md:col-span-3">{(id) => <Textarea id={id} className="font-sans text-[13px]" value={s.info.description} onChange={(e) => setS({ ...s, info: { ...s.info, description: e.target.value } })} />}</Field>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="2. SIP transport">
          <div className="space-y-3">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={s.transport.mode === 'existing'} disabled={!transports.data?.length} onChange={() => setS({ ...s, transport: { ...s.transport, mode: 'existing' } })} />Use an existing transport</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={s.transport.mode === 'new'} onChange={() => setS({ ...s, transport: { ...s.transport, mode: 'new', protocol: s.info.protocol, name: `transport-${s.info.protocol}` } })} />Create a new transport</label>
            </div>
            {s.transport.mode === 'existing' ? (
              <Field label="Transport" error={errors['existingName']}>{(id) => (
                <Select id={id} value={s.transport.existingName} onChange={(e) => setS({ ...s, transport: { ...s.transport, existingName: e.target.value } })}>
                  {transports.data?.map((t) => <option key={t.id} value={t.name}>{t.name} — {t.protocol?.toUpperCase()} {t.bindAddress}:{t.bindPort}</option>)}
                </Select>
              )}</Field>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Name" required error={errors['name']}>{(id) => <Input id={id} value={s.transport.name} onChange={(e) => setS({ ...s, transport: { ...s.transport, name: e.target.value } })} />}</Field>
                <Field label="Protocol">{(id) => (
                  <Select id={id} value={s.transport.protocol} onChange={(e) => setS({ ...s, transport: { ...s.transport, protocol: e.target.value as 'udp' | 'tcp' | 'tls', bindPort: e.target.value === 'tls' ? 5061 : 5060 } })}>
                    <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
                  </Select>
                )}</Field>
                <div />
                <Field label="Bind address" required>{(id) => <Input id={id} value={s.transport.bindAddress} onChange={(e) => setS({ ...s, transport: { ...s.transport, bindAddress: e.target.value } })} />}</Field>
                <Field label="Port" required error={errors['bindPort']}>{(id) => <Input id={id} type="number" value={s.transport.bindPort} onChange={(e) => setS({ ...s, transport: { ...s.transport, bindPort: Number(e.target.value) } })} />}</Field>
                <Field label="External address" help="Public IP/host for NAT">{(id) => <Input id={id} value={s.transport.externalAddress} onChange={(e) => setS({ ...s, transport: { ...s.transport, externalAddress: e.target.value } })} />}</Field>
                <Field label="Local networks" error={errors['localNet']} help="Comma-separated CIDRs" className="md:col-span-3">{(id) => <Input id={id} value={s.transport.localNet} onChange={(e) => setS({ ...s, transport: { ...s.transport, localNet: e.target.value } })} placeholder="192.168.0.0/16, 10.0.0.0/8" />}</Field>
                {s.transport.protocol === 'tls' && <>
                  <Field label="Certificate file" required error={errors['certFile']}>{(id) => <Input id={id} value={s.transport.certFile} onChange={(e) => setS({ ...s, transport: { ...s.transport, certFile: e.target.value } })} placeholder="/etc/asterisk/keys/asterisk.crt" />}</Field>
                  <Field label="Private key file" required>{(id) => <Input id={id} value={s.transport.privKeyFile} onChange={(e) => setS({ ...s, transport: { ...s.transport, privKeyFile: e.target.value } })} placeholder="/etc/asterisk/keys/asterisk.key" />}</Field>
                </>}
                <div className="md:col-span-3"><InlineAlert tone="warn">New or changed transports take effect only after an Asterisk restart (res_pjsip cannot reload transports).</InlineAlert></div>
              </div>
            )}
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card title="3. SIP trunk">
          <TrunkFields value={{ ...s.trunk, transportName: effectiveTransport(s) }} onChange={(t) => setS({ ...s, trunk: t })} errors={errors}
            templates={templates.data ?? []} transports={[effectiveTransport(s)].filter(Boolean)} />
        </Card>
      )}

      {step === 3 && (
        <Card title="4. PJSIP configuration">
          <p className="mb-3 text-[13px] text-text-2">These objects are generated from the trunk by the same code the backend uses. Fine-tune any of them later on the PJSIP pages.</p>
          {preview.length ? <PjsipGraph objects={preview} /> : <InlineAlert tone="warn">Complete the trunk step to preview the generated objects.</InlineAlert>}
        </Card>
      )}

      {step === 4 && (
        <Card title="5. Routes" actions={<>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setS({ ...s, routes: [...s.routes, newRoute('INBOUND')] })}>Inbound route</Button>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setS({ ...s, routes: [...s.routes, newRoute('OUTBOUND')] })}>Outbound route</Button>
        </>}>
          {s.routes.length === 0 ? <EmptyState title="No routes yet" description="Routes decide where calls arriving from this PBX go and how they are recorded. You can also add them later." /> : (
            <div className="space-y-3">
              {s.routes.map((r, i) => (
                <WizardRouteEditor key={r.key} route={r} index={i} errors={errors} saved={Boolean(s.created.routes[r.key])}
                  trunks={(trunks.data ?? []).map((t) => ({ id: t.id, name: `${t.name}${t.pbx ? ` (${t.pbx.name})` : ''}` }))} newTrunkName={s.trunk.name}
                  callTypes={callTypes.data ?? []} policies={policies.data ?? []}
                  onChange={(nr) => setS({ ...s, routes: s.routes.map((x) => (x.key === r.key ? nr : x)) })}
                  onRemove={() => setS({ ...s, routes: s.routes.filter((x) => x.key !== r.key) })} />
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <div className="space-y-1">
              {saveLog.map((l) => <div key={l.label} className="flex items-center gap-2 text-[12.5px]"><StatusBadge tone={l.ok ? 'ok' : 'crit'}>{l.ok ? 'Saved' : 'Failed'}</StatusBadge>{l.label}{l.message && <span className="text-crit">{l.message}</span>}</div>)}
            </div>
            <Button variant="primary" icon={<Save className="size-3.5" />} loading={save.isPending} onClick={() => { const e = validateStep(4, s); setErrors(e); if (!Object.keys(e).length) save.mutate(); }}>
              Save drafts & continue
            </Button>
          </div>
        </Card>
      )}

      {step === 5 && <TestStep state={s} serverId={serverId} />}
      {step === 6 && <ApplyStep state={s} serverId={serverId} />}

      {step < 4 && (
        <div className="flex justify-between">
          <Button icon={<ArrowLeft className="size-3.5" />} disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
          <Button variant="primary" onClick={next}>Next <ArrowRight className="size-3.5" /></Button>
        </div>
      )}
      {step === 5 && <div className="flex justify-end"><Button variant="primary" onClick={() => setStep(6)}>Continue to apply <ArrowRight className="size-3.5" /></Button></div>}
    </div>
  );
}

function WizardRouteEditor({ route: r, index, errors, onChange, onRemove, trunks, newTrunkName, callTypes, policies, saved }: {
  route: WizardRoute; index: number; errors: Record<string, string>; onChange: (r: WizardRoute) => void; onRemove: () => void; saved: boolean;
  trunks: Array<{ id: string; name: string }>; newTrunkName: string; callTypes: Array<{ id: string; name: string }>; policies: Array<{ id: string; name: string }>;
}) {
  const e = (k: string) => errors[`routes.${index}.${k}`];
  const p = r.patterns[0]!;
  const setP = (patch: Partial<typeof p>) => onChange({ ...r, patterns: [{ ...p, ...patch }] });
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium">{r.direction === 'INBOUND' ? 'Inbound route' : 'Outbound route'}{saved && <StatusBadge tone="ok">Saved as draft</StatusBadge>}</span>
        {!saved && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>Remove</Button>}
      </div>
      <fieldset disabled={saved} className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Field label="Name" required error={e('name')} className="col-span-2">{(id) => <Input id={id} value={r.name} onChange={(ev) => onChange({ ...r, name: ev.target.value })} />}</Field>
        <Field label="Direction">{(id) => (
          <Select id={id} value={r.direction} onChange={(ev) => onChange({ ...r, direction: ev.target.value as WizardRoute['direction'] })}>
            {['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT'].map((d) => <option key={d}>{d}</option>)}
          </Select>
        )}</Field>
        <Field label="Priority" help="Lower = matched first" error={e('priority')}>{(id) => <Input id={id} type="number" value={r.priority} onChange={(ev) => onChange({ ...r, priority: Number(ev.target.value) })} />}</Field>
        <Field label="Prefix" error={e('patterns.0.prefix')}>{(id) => <Input id={id} value={p.prefix ?? ''} onChange={(ev) => setP({ prefix: ev.target.value })} placeholder="9" />}</Field>
        <Field label="Pattern" required error={e('patterns.0.pattern')}>{(id) => <Input id={id} className="font-mono" value={p.pattern} onChange={(ev) => setP({ pattern: ev.target.value })} placeholder="XXXXXXXXXX" />}</Field>
        <Field label="Strip digits" help="After the prefix">{(id) => <Input id={id} type="number" value={p.stripDigits} onChange={(ev) => setP({ stripDigits: Number(ev.target.value) })} />}</Field>
        <Field label="Prepend" error={e('patterns.0.prepend')}>{(id) => <Input id={id} value={p.prepend ?? ''} onChange={(ev) => setP({ prepend: ev.target.value })} />}</Field>
        <Field label="Destination">{(id) => (
          <Select id={id} value={r.egressKind} onChange={(ev) => onChange({ ...r, egressKind: ev.target.value as WizardRoute['egressKind'] })}>
            <option value="TRUNK">SIP trunk</option><option value="CONTEXT">Dialplan context</option><option value="HANGUP">Reject (hang up)</option>
          </Select>
        )}</Field>
        {r.egressKind === 'TRUNK' && <Field label="Trunk" required error={e('egressTrunkId')} className="col-span-2">{(id) => (
          <Select id={id} value={r.egressTrunkId ?? ''} onChange={(ev) => onChange({ ...r, egressTrunkId: ev.target.value })}>
            <option value="">Select…</option>
            <option value="NEW">{newTrunkName || 'New trunk'} (this wizard)</option>
            {trunks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}</Field>}
        {r.egressKind === 'CONTEXT' && <Field label="Context" required error={e('egressContext')} className="col-span-2">{(id) => <Input id={id} value={r.egressContext ?? ''} onChange={(ev) => onChange({ ...r, egressContext: ev.target.value })} placeholder="internal-extensions" />}</Field>}
        <Field label="Call type">{(id) => (
          <Select id={id} value={r.callTypeId ?? ''} onChange={(ev) => onChange({ ...r, callTypeId: ev.target.value })}>
            <option value="">Classify automatically</option>
            {callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Recording policy">{(id) => (
          <Select id={id} value={r.recordingPolicyId ?? ''} onChange={(ev) => onChange({ ...r, recordingPolicyId: ev.target.value })}>
            <option value="">Inherit (PBX / default)</option>
            {policies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}</Field>
        <div className="flex items-end pb-1.5"><Checkbox label="Enabled" checked={r.enabled} onChange={(v) => onChange({ ...r, enabled: v })} /></div>
      </fieldset>
    </div>
  );
}

function TestStep({ state, serverId }: { state: WizardState; serverId: string }) {
  const validate = useMutation({ mutationFn: () => configApi.validate(serverId) });
  const net = useMutation({ mutationFn: () => trunkApi.test(state.created.trunkId!) });
  const [number, setNumber] = useState('');
  const route = useMutation({ mutationFn: () => routeApi.test(number, state.created.pbxId!) });
  useEffect(() => { validate.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Configuration validation" actions={<Button size="sm" loading={validate.isPending} onClick={() => validate.mutate()}>Re-run</Button>}>
        {validate.isPending ? <LoadingState /> : validate.error ? <InlineAlert tone="crit">{errorMessage(validate.error)}</InlineAlert> : validate.data && (
          validate.data.ok ? <InlineAlert tone="ok" title="Endpoint, AOR, auth, identify, transport and dialplan validate">{validate.data.issues.length ? <IssueList issues={validate.data.issues} /> : 'No issues.'}</InlineAlert>
            : <InlineAlert tone="crit" title="Validation errors"><IssueList issues={validate.data.issues} /></InlineAlert>
        )}
      </Card>
      <Card title="Route matching" >
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (number) route.mutate(); }}>
          <Field label="Dialled number" className="flex-1">{(id) => <Input id={id} className="font-mono" value={number} onChange={(e) => setNumber(e.target.value.replace(/[^0-9*#+]/g, ''))} placeholder="90501234567" />}</Field>
          <Button type="submit" icon={<TestTube2 className="size-3.5" />} loading={route.isPending} disabled={!number}>Test</Button>
        </form>
        {route.data && <div className="mt-3"><RouteTestSummary r={route.data} /></div>}
        {route.error && <div className="mt-3"><InlineAlert tone="crit">{errorMessage(route.error)}</InlineAlert></div>}
      </Card>
      <Card title="Network & SIP connectivity" className="xl:col-span-2" actions={<Button size="sm" icon={<TestTube2 className="size-3.5" />} loading={net.isPending} disabled={!state.created.trunkId} onClick={() => net.mutate()}>Run trunk test</Button>}>
        <p className="mb-2 text-[12.5px] text-muted">DNS and transport reachability work now. The PJSIP endpoint, SIP OPTIONS and registration checks only pass after the configuration is applied (next step), because drafts are not live in Asterisk yet.</p>
        {net.data && <TestResults results={net.data.results as TrunkTestResults} />}
        {net.error && <InlineAlert tone="crit">{errorMessage(net.error)}</InlineAlert>}
      </Card>
    </div>
  );
}

function ApplyStep({ state, serverId }: { state: WizardState; serverId: string }) {
  const [applied, setApplied] = useState(false);
  const post = useMutation({ mutationFn: () => trunkApi.test(state.created.trunkId!) });
  return (
    <div className="space-y-4">
      <Card title="Changes in this wizard">
        <ul className="space-y-1 text-[13px]">
          {state.transport.mode === 'new' && <li>Transport <span className="font-mono">{state.transport.name}</span> ({state.transport.protocol.toUpperCase()} {state.transport.bindAddress}:{state.transport.bindPort}) — requires an Asterisk restart</li>}
          <li>PBX <span className="font-medium">{state.info.name}</span> ({state.info.vendor}, {state.info.host}:{state.info.port})</li>
          <li>Trunk <span className="font-mono">{state.trunk.name}</span> → endpoint, AOR, identify{state.trunk.authMode === 'USERPASS' ? ', auth' : ''}{state.trunk.sipMode === 'REGISTER_OUTBOUND' ? ', registration' : ''}</li>
          {state.routes.map((r) => <li key={r.key}>Route <span className="font-medium">{r.name}</span> ({r.direction}, <span className="font-mono">{r.patterns[0]?.prefix}{r.patterns[0]?.pattern}</span>)</li>)}
        </ul>
      </Card>
      <ApplyPanel serverId={serverId} summary={`Add PBX ${state.info.name}`} onApplied={(r) => setApplied(r.status === 'APPLIED' || r.status === 'NO_CHANGES')} />
      {applied && state.created.trunkId && (
        <Card title="Post-apply connectivity test" actions={<Button size="sm" icon={<TestTube2 className="size-3.5" />} loading={post.isPending} onClick={() => post.mutate()}>Test trunk now</Button>}>
          {post.data ? <TestResults results={post.data.results as TrunkTestResults} /> : <p className="text-[13px] text-muted">Runs DNS, transport, PJSIP endpoint, SIP OPTIONS and registration checks against the live configuration.</p>}
          {post.error && <InlineAlert tone="crit">{errorMessage(post.error)}</InlineAlert>}
          <p className="mt-3 text-[13px]"><Link className="text-primary hover:underline" href="/pbx">Back to PBX systems</Link></p>
        </Card>
      )}
    </div>
  );
}
