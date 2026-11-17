'use client';
import { Plus, Trash2 } from 'lucide-react';
import { comparePatternSpecificity, compilePattern } from '@echelons/shared';
import type { CallType, Pbx, RecordingPolicy, Route, RouteInput, Trunk } from '@/lib/api/types';
import type { RouteForm } from '@/lib/validation';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui/primitives';

export function emptyRouteForm(pbxId = ''): RouteForm {
  return { name: '', pbxId, direction: 'OUTBOUND', priority: 100, egressKind: 'TRUNK', egressTrunkId: '', egressContext: '', callTypeId: '', recordingPolicyId: '', callerIdNumber: '', dialTimeout: 60, enabled: true, patterns: [{ pattern: '', prefix: '', stripDigits: 0, prepend: '', enabled: true }] };
}

export function routeToForm(r: Route): RouteForm {
  return {
    name: r.name, pbxId: r.pbxId, direction: r.direction, priority: r.priority, egressKind: r.egressKind, egressTrunkId: r.egressTrunkId ?? '', egressContext: r.egressContext ?? '',
    callTypeId: r.callTypeId ?? '', recordingPolicyId: r.recordingPolicyId ?? '', callerIdNumber: r.callerIdNumber ?? '', dialTimeout: r.dialTimeout, enabled: r.enabled,
    patterns: r.patterns.map((p) => ({ pattern: p.pattern, prefix: p.prefix ?? '', stripDigits: p.stripDigits, prepend: p.prepend ?? '', enabled: p.enabled })),
  };
}

export function formToRouteInput(f: RouteForm, routeNumber?: number): RouteInput {
  return {
    ...(routeNumber ? { routeNumber } : {}), name: f.name, pbxId: f.pbxId, direction: f.direction, priority: Number(f.priority), egressKind: f.egressKind,
    egressTrunkId: f.egressKind === 'TRUNK' ? f.egressTrunkId || null : null, egressContext: f.egressKind === 'CONTEXT' ? f.egressContext || null : null,
    callTypeId: f.callTypeId || null, recordingPolicyId: f.recordingPolicyId || null, callerIdNumber: f.callerIdNumber || null, dialTimeout: Number(f.dialTimeout), enabled: f.enabled,
    patterns: f.patterns.map((p) => ({ pattern: p.pattern.trim(), prefix: p.prefix || null, stripDigits: Number(p.stripDigits), prepend: p.prepend || null, enabled: p.enabled })),
  };
}

export function RouteEditor({ value: f, onChange, errors, pbxs, trunks, callTypes, policies }: {
  value: RouteForm; onChange: (f: RouteForm) => void; errors: Record<string, string>; pbxs: Pbx[]; trunks: Trunk[]; callTypes: CallType[]; policies: RecordingPolicy[];
}) {
  const set = <K extends keyof RouteForm>(k: K, v: RouteForm[K]) => onChange({ ...f, [k]: v });
  const pbx = pbxs.find((p) => p.id === f.pbxId);
  const sameServerTrunks = trunks.filter((t) => !pbx || pbxs.find((p) => p.id === t.pbxId)?.serverId === pbx.serverId);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Route name" required error={errors['name']} className="col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="International outbound" />}</Field>
        <Field label="Calls from PBX" required error={errors['pbxId']}>{(id) => (
          <Select id={id} value={f.pbxId} onChange={(e) => set('pbxId', e.target.value)}>
            <option value="">Select…</option>{pbxs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Direction">{(id) => <Select id={id} value={f.direction} onChange={(e) => set('direction', e.target.value as RouteForm['direction'])}>{['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT'].map((d) => <option key={d}>{d}</option>)}</Select>}</Field>
        <Field label="Priority" error={errors['priority']} help="Lower tiers are matched first">{(id) => <Input id={id} type="number" value={f.priority} onChange={(e) => set('priority', Number(e.target.value))} />}</Field>
        <Field label="Destination">{(id) => (
          <Select id={id} value={f.egressKind} onChange={(e) => set('egressKind', e.target.value as RouteForm['egressKind'])}>
            <option value="TRUNK">SIP trunk</option><option value="CONTEXT">Dialplan context</option><option value="HANGUP">Reject (hang up)</option>
          </Select>
        )}</Field>
        {f.egressKind === 'TRUNK' && <Field label="Trunk" required error={errors['egressTrunkId']} className="col-span-2">{(id) => (
          <Select id={id} value={f.egressTrunkId} onChange={(e) => set('egressTrunkId', e.target.value)}>
            <option value="">Select…</option>{sameServerTrunks.map((t) => <option key={t.id} value={t.id}>{t.name}{t.pbx ? ` — ${t.pbx.name}` : ''}</option>)}
          </Select>
        )}</Field>}
        {f.egressKind === 'CONTEXT' && <Field label="Context" required error={errors['egressContext']} className="col-span-2">{(id) => <Input id={id} className="font-mono" value={f.egressContext} onChange={(e) => set('egressContext', e.target.value)} />}</Field>}
        <Field label="Call type">{(id) => <Select id={id} value={f.callTypeId} onChange={(e) => set('callTypeId', e.target.value)}><option value="">Classify automatically</option>{callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Recording policy">{(id) => <Select id={id} value={f.recordingPolicyId} onChange={(e) => set('recordingPolicyId', e.target.value)}><option value="">Inherit (PBX / default)</option>{policies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.mode.toLowerCase()})</option>)}</Select>}</Field>
        <Field label="Caller ID number override" error={errors['callerIdNumber']}>{(id) => <Input id={id} value={f.callerIdNumber} onChange={(e) => set('callerIdNumber', e.target.value)} />}</Field>
        <Field label="Dial timeout (s)" error={errors['dialTimeout']}>{(id) => <Input id={id} type="number" value={f.dialTimeout} onChange={(e) => set('dialTimeout', Number(e.target.value))} />}</Field>
        <div className="flex items-end pb-1.5"><Checkbox label="Route enabled" checked={f.enabled} onChange={(v) => set('enabled', v)} /></div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">Patterns</p>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set('patterns', [...f.patterns, { pattern: '', prefix: '', stripDigits: 0, prepend: '', enabled: true }])}>Add pattern</Button>
        </div>
        {errors['patterns'] && <p className="mb-2 text-xs text-crit">{errors['patterns']}</p>}
        <div className="space-y-2">
          {f.patterns.map((p, i) => {
            const e = (k: string) => errors[`patterns.${i}.${k}`];
            const up = (patch: Partial<typeof p>) => set('patterns', f.patterns.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md border border-border p-2 md:grid-cols-[6rem_1fr_6rem_8rem_auto_auto]">
                <Field label="Prefix" error={e('prefix')}>{(id) => <Input id={id} className="font-mono" value={p.prefix} onChange={(ev) => up({ prefix: ev.target.value })} placeholder="00" />}</Field>
                <Field label="Pattern" required error={e('pattern')}>{(id) => <Input id={id} className="font-mono" value={p.pattern} onChange={(ev) => up({ pattern: ev.target.value })} placeholder="X." />}</Field>
                <Field label="Strip" error={e('stripDigits')} help="after prefix">{(id) => <Input id={id} type="number" value={p.stripDigits} onChange={(ev) => up({ stripDigits: Number(ev.target.value) })} />}</Field>
                <Field label="Prepend" error={e('prepend')}>{(id) => <Input id={id} className="font-mono" value={p.prepend} onChange={(ev) => up({ prepend: ev.target.value })} />}</Field>
                <div className="pb-1.5"><Checkbox label="On" checked={p.enabled} onChange={(v) => up({ enabled: v })} /></div>
                <Button size="sm" variant="ghost" aria-label="Remove pattern" disabled={f.patterns.length === 1} icon={<Trash2 className="size-3.5" />} onClick={() => set('patterns', f.patterns.filter((_, j) => j !== i))} />
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted">Syntax: X = 0-9, Z = 1-9, N = 2-9, [2-5] ranges, “.” one or more, “!” zero or more (last position only). The prefix is matched and stripped automatically.</p>
      </div>
    </div>
  );
}

/** Effective match order for one PBX: priority tier, then Asterisk specificity (same rule as the dialplan). */
export function matchingOrder(routes: Route[]) {
  const rows = routes.filter((r) => r.enabled).flatMap((r) => r.patterns.filter((p) => p.enabled).map((p) => {
    const full = `${p.prefix ?? ''}${p.pattern.replace(/^_/, '')}`;
    let valid = true;
    try { compilePattern(full); } catch { valid = false; }
    return { route: r, pattern: p, full, valid };
  }));
  return rows.filter((x) => x.valid).sort((a, b) => a.route.priority - b.route.priority || comparePatternSpecificity(a.full, b.full));
}

