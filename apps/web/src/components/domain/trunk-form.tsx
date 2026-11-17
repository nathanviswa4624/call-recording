'use client';
import type { Trunk, TrunkInput, TrunkTemplate } from '@/lib/api/types';
import type { TrunkForm } from '@/lib/validation';
import { Field, Input, Select } from '@/components/ui/primitives';

export function emptyTrunkForm(partial: Partial<TrunkForm> = {}): TrunkForm {
  return {
    name: '', templateId: '', host: '', port: 5060, protocol: 'udp', transportName: '', authMode: 'IP', sipMode: 'PEER',
    username: '', password: '', hasStoredPassword: false, realm: '', remoteDomain: '', outboundProxy: '', codecs: 'ulaw,alaw',
    dtmfMode: 'rfc4733', inboundContext: '', matchNetworks: '', qualifyFrequency: 60, ...partial,
  };
}

/** Existing trunk → form. The stored password is NEVER sent to the browser; only `hasPassword`. */
export function trunkToForm(t: Trunk): TrunkForm {
  const ep = t.overrides?.endpoint ?? {};
  return emptyTrunkForm({
    name: t.name, templateId: t.templateId ?? '', host: t.host, port: t.port, protocol: t.protocol, transportName: t.transportName, authMode: t.authMode,
    sipMode: t.sipMode, username: t.username ?? '', password: '', hasStoredPassword: t.hasPassword, realm: t.realm ?? '', remoteDomain: t.remoteDomain ?? '',
    outboundProxy: (ep['outbound_proxy'] as string) ?? '', codecs: (ep['allow'] as string) ?? 'ulaw,alaw', dtmfMode: ((ep['dtmf_mode'] as TrunkForm['dtmfMode']) ?? 'rfc4733'),
    inboundContext: t.inboundContext, matchNetworks: t.matchNetworks.join(', '), qualifyFrequency: t.qualifyFrequency,
  });
}

/** Form → backend TrunkInput. Codec/DTMF/proxy become endpoint overrides so they survive regeneration. */
export function formToTrunkInput(f: TrunkForm, enabled = true): TrunkInput {
  const endpoint: Record<string, string> = { dtmf_mode: f.dtmfMode };
  if (f.codecs) { endpoint['disallow'] = 'all'; endpoint['allow'] = f.codecs; }
  if (f.outboundProxy) endpoint['outbound_proxy'] = f.outboundProxy;
  return {
    name: f.name, templateId: f.templateId || null, host: f.host, port: Number(f.port), protocol: f.protocol, transportName: f.transportName,
    authMode: f.authMode, sipMode: f.sipMode, username: f.authMode === 'USERPASS' ? f.username || null : null,
    ...(f.authMode === 'USERPASS' && f.password ? { password: f.password } : {}),
    realm: f.realm || null, remoteDomain: f.remoteDomain || null, inboundContext: f.inboundContext,
    matchNetworks: (f.matchNetworks ?? '').split(',').map((s) => s.trim()).filter(Boolean), qualifyFrequency: Number(f.qualifyFrequency),
    overrides: { endpoint }, enabled,
  };
}

export function TrunkFields({ value, onChange, errors, templates, transports }: {
  value: TrunkForm; onChange: (v: TrunkForm) => void; errors: Record<string, string>; templates: TrunkTemplate[]; transports: string[];
}) {
  const set = <K extends keyof TrunkForm>(k: K, v: TrunkForm[K]) => onChange({ ...value, [k]: v });
  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return set('templateId', '');
    const ep = t.defaults.endpoint ?? {};
    onChange({ ...value, templateId: id, codecs: (ep['allow'] as string) ?? value.codecs, dtmfMode: ((ep['dtmf_mode'] as TrunkForm['dtmfMode']) ?? value.dtmfMode), protocol: (['udp', 'tcp', 'tls'].includes(t.defaultProtocol) ? t.defaultProtocol : value.protocol) as TrunkForm['protocol'], port: t.defaultPort });
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label="Trunk name" required error={errors['name']} help="Becomes the PJSIP endpoint/AOR name">{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={Boolean(errors['name'])} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="AVAYA-PBX" />}</Field>
      <Field label="Vendor template" help="Suggested defaults; every field stays editable">{(id) => (
        <Select id={id} value={value.templateId ?? ''} onChange={(e) => applyTemplate(e.target.value)}>
          <option value="">None</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      )}</Field>
      <Field label="Inbound context" required error={errors['inboundContext']} help="Calls from this trunk enter here">{(id) => <Input id={id} aria-invalid={Boolean(errors['inboundContext'])} value={value.inboundContext} onChange={(e) => set('inboundContext', e.target.value)} placeholder="from-avaya" />}</Field>
      <Field label="Server address" required error={errors['host']}>{(id) => <Input id={id} aria-invalid={Boolean(errors['host'])} value={value.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.51.10" />}</Field>
      <Field label="Port" required error={errors['port']}>{(id) => <Input id={id} type="number" value={value.port} onChange={(e) => set('port', Number(e.target.value))} />}</Field>
      <Field label="Protocol">{(id) => (
        <Select id={id} value={value.protocol} onChange={(e) => set('protocol', e.target.value as TrunkForm['protocol'])}>
          <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
        </Select>
      )}</Field>
      <Field label="Transport" required error={errors['transportName']}>{(id) => (
        <Select id={id} aria-invalid={Boolean(errors['transportName'])} value={value.transportName} onChange={(e) => set('transportName', e.target.value)}>
          <option value="">Select…</option>
          {transports.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      )}</Field>
      <Field label="Authentication" error={errors['authMode']}>{(id) => (
        <Select id={id} value={value.authMode} onChange={(e) => set('authMode', e.target.value as TrunkForm['authMode'])}>
          <option value="IP">IP-based (identify by source address)</option>
          <option value="NONE">None</option>
          <option value="USERPASS">Username / password</option>
        </Select>
      )}</Field>
      <Field label="Registration">{(id) => (
        <Select id={id} value={value.sipMode} onChange={(e) => set('sipMode', e.target.value as TrunkForm['sipMode'])}>
          <option value="PEER">None (static peer)</option>
          <option value="REGISTER_OUTBOUND">Asterisk registers to the PBX</option>
          <option value="ACCEPT_REGISTRATION">PBX registers to Asterisk</option>
        </Select>
      )}</Field>
      {value.authMode === 'USERPASS' && <>
        <Field label="Username" required error={errors['username']}>{(id) => <Input id={id} aria-invalid={Boolean(errors['username'])} autoComplete="off" value={value.username} onChange={(e) => set('username', e.target.value)} />}</Field>
        <Field label="Password" required={!value.hasStoredPassword} error={errors['password']} help={value.hasStoredPassword ? 'A password is stored. Leave blank to keep it.' : 'Encrypted at rest; never shown again.'}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" aria-invalid={Boolean(errors['password'])} value={value.password} onChange={(e) => set('password', e.target.value)} placeholder={value.hasStoredPassword ? '••••••••  (unchanged)' : ''} />}
        </Field>
        <Field label="Realm">{(id) => <Input id={id} value={value.realm} onChange={(e) => set('realm', e.target.value)} />}</Field>
      </>}
      <Field label="Remote domain" help="from_domain; defaults to the server address">{(id) => <Input id={id} value={value.remoteDomain} onChange={(e) => set('remoteDomain', e.target.value)} />}</Field>
      <Field label="Outbound proxy" help="Optional, e.g. sip:proxy.example.com">{(id) => <Input id={id} value={value.outboundProxy} onChange={(e) => set('outboundProxy', e.target.value)} />}</Field>
      <Field label="Codecs" error={errors['codecs']} help="Ordered, comma-separated">{(id) => <Input id={id} aria-invalid={Boolean(errors['codecs'])} value={value.codecs} onChange={(e) => set('codecs', e.target.value)} />}</Field>
      <Field label="DTMF mode">{(id) => (
        <Select id={id} value={value.dtmfMode} onChange={(e) => set('dtmfMode', e.target.value as TrunkForm['dtmfMode'])}>
          {['rfc4733', 'inband', 'info', 'auto', 'auto_info'].map((m) => <option key={m}>{m}</option>)}
        </Select>
      )}</Field>
      <Field label="Qualify frequency (s)" help="SIP OPTIONS interval; 0 disables">{(id) => <Input id={id} type="number" value={value.qualifyFrequency} onChange={(e) => set('qualifyFrequency', Number(e.target.value))} />}</Field>
      <Field label="Additional source networks" error={errors['matchNetworks']} help="Identify rule matches, e.g. 192.168.51.0/24">{(id) => <Input id={id} aria-invalid={Boolean(errors['matchNetworks'])} value={value.matchNetworks} onChange={(e) => set('matchNetworks', e.target.value)} />}</Field>
    </div>
  );
}
