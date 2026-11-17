'use client';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, RotateCcw, Search } from 'lucide-react';
import { pbxApi } from '@/lib/api/pbx';
import { trunkApi } from '@/lib/api/trunks';
import { routeApi } from '@/lib/api/routes';
import type { CallFilters } from '@/lib/api/calls';
import { useAuth } from '@/lib/auth';
import { PERMISSIONS as P } from '@echelons/shared';
import { toLocalInput } from '@/lib/format';
import { Button, Field, Input, Select } from '@/components/ui/primitives';

const ARRAY_KEYS = ['pbxId', 'trunkId', 'routeId', 'routePatternId', 'callTypeId', 'direction', 'status'] as const;
const NUMBER_KEYS = ['minDuration', 'maxDuration'] as const;
const STRING_KEYS = ['from', 'to', 'caller', 'destination', 'number', 'extension', 'destinationPattern', 'uniqueId', 'tag', 'department'] as const;

/** URL search params → typed filters (unknown keys ignored). */
export function filtersFromParams(params: URLSearchParams): CallFilters {
  const f: CallFilters = {};
  for (const k of STRING_KEYS) { const v = params.get(k); if (v) (f as Record<string, unknown>)[k] = v; }
  for (const k of ARRAY_KEYS) { const v = params.get(k); if (v) (f as Record<string, unknown>)[k] = v.split(',').filter(Boolean); }
  for (const k of NUMBER_KEYS) { const v = params.get(k); if (v && /^\d+$/.test(v)) (f as Record<string, unknown>)[k] = Number(v); }
  return f;
}

export function filtersToParams(f: CallFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || k === 'cursor' || k === 'limit') continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); } else p.set(k, String(v));
  }
  return p;
}

const isoToLocal = (iso?: string) => (iso ? toLocalInput(new Date(iso)) : '');
const localToIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function SearchFilters({ value, onApply, presetStatus }: { value: CallFilters; onApply: (f: CallFilters) => void; presetStatus?: string[] }) {
  const { can } = useAuth();
  const [f, setF] = useState<CallFilters>(value);
  const [more, setMore] = useState(Boolean(value.routePatternId || value.trunkId || value.uniqueId || value.destinationPattern || value.minDuration || value.maxDuration));
  const canMeta = can(P.TRUNKS_VIEW);
  const canRoutes = can(P.ROUTES_VIEW);
  const pbxs = useQuery({ queryKey: ['pbxs'], queryFn: pbxApi.list, enabled: canMeta });
  const trunks = useQuery({ queryKey: ['trunks'], queryFn: trunkApi.list, enabled: canMeta });
  const routes = useQuery({ queryKey: ['routes'], queryFn: routeApi.list, enabled: canRoutes });
  const patterns = useQuery({ queryKey: ['route-patterns'], queryFn: routeApi.patterns, enabled: canRoutes });
  const types = useQuery({ queryKey: ['call-types'], queryFn: routeApi.callTypes, enabled: canRoutes });
  const set = (patch: Partial<CallFilters>) => setF((x) => ({ ...x, ...patch }));
  const one = (k: (typeof ARRAY_KEYS)[number]) => (f[k]?.[0] ?? '');
  const setOne = (k: (typeof ARRAY_KEYS)[number], v: string) => set({ [k]: v ? [v] : undefined });

  const submit = (e: FormEvent) => { e.preventDefault(); onApply({ ...f, ...(presetStatus ? { status: presetStatus } : {}) }); };
  const reset = () => { const empty: CallFilters = {}; setF(empty); onApply(presetStatus ? { status: presetStatus } : empty); };

  return (
    <form onSubmit={submit} aria-label="Search filters" className="rounded-lg border border-border bg-surface p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Field label="From">{(id) => <Input id={id} type="datetime-local" value={isoToLocal(f.from)} onChange={(e) => set({ from: localToIso(e.target.value) })} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="datetime-local" value={isoToLocal(f.to)} onChange={(e) => set({ to: localToIso(e.target.value) })} />}</Field>
        <Field label="Caller">{(id) => <Input id={id} inputMode="tel" value={f.caller ?? ''} onChange={(e) => set({ caller: e.target.value || undefined })} />}</Field>
        <Field label="Called number">{(id) => <Input id={id} inputMode="tel" value={f.destination ?? ''} onChange={(e) => set({ destination: e.target.value || undefined })} />}</Field>
        <Field label="Extension">{(id) => <Input id={id} value={f.extension ?? ''} onChange={(e) => set({ extension: e.target.value || undefined })} />}</Field>
        <Field label="Direction">{(id) => <Select id={id} value={one('direction')} onChange={(e) => setOne('direction', e.target.value)}><option value="">Any</option>{['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT'].map((d) => <option key={d} value={d}>{d[0] + d.slice(1).toLowerCase()}</option>)}</Select>}</Field>
        {!presetStatus && <Field label="Status">{(id) => <Select id={id} value={one('status')} onChange={(e) => setOne('status', e.target.value)}><option value="">Any</option>{[['ANSWERED', 'Answered'], ['NO_ANSWER', 'No answer'], ['BUSY', 'Busy'], ['FAILED', 'Failed'], ['ABANDONED', 'Abandoned']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>}
        {canRoutes && <Field label="Call type">{(id) => <Select id={id} value={one('callTypeId')} onChange={(e) => setOne('callTypeId', e.target.value)}><option value="">Any</option>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>}
        {more && <>
          {canMeta && <Field label="PBX">{(id) => <Select id={id} value={one('pbxId')} onChange={(e) => setOne('pbxId', e.target.value)}><option value="">Any</option>{pbxs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>}
          {canMeta && <Field label="Trunk">{(id) => <Select id={id} value={one('trunkId')} onChange={(e) => setOne('trunkId', e.target.value)}><option value="">Any</option>{trunks.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>}
          {canRoutes && <Field label="Route">{(id) => <Select id={id} value={one('routeId')} onChange={(e) => setOne('routeId', e.target.value)}><option value="">Any</option>{routes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
          {canRoutes && <Field label="Route pattern">{(id) => <Select id={id} value={one('routePatternId')} onChange={(e) => setOne('routePatternId', e.target.value)}><option value="">Any</option>{patterns.data?.map((p) => <option key={p.id} value={p.id}>{p.prefix ?? ''}{p.pattern} — {p.route.name}</option>)}</Select>}</Field>}
          <Field label="Dialled matches pattern" help="Asterisk syntax">{(id) => <Input id={id} className="font-mono" value={f.destinationPattern ?? ''} onChange={(e) => set({ destinationPattern: e.target.value || undefined })} placeholder="9XXXXXXXXXX" />}</Field>
          <Field label="Min duration (s)">{(id) => <Input id={id} type="number" min={0} value={f.minDuration ?? ''} onChange={(e) => set({ minDuration: e.target.value === '' ? undefined : Number(e.target.value) })} />}</Field>
          <Field label="Max duration (s)">{(id) => <Input id={id} type="number" min={0} value={f.maxDuration ?? ''} onChange={(e) => set({ maxDuration: e.target.value === '' ? undefined : Number(e.target.value) })} />}</Field>
          <Field label="Unique / linked ID">{(id) => <Input id={id} className="font-mono" value={f.uniqueId ?? ''} onChange={(e) => set({ uniqueId: e.target.value || undefined })} />}</Field>
        </>}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <Button size="sm" variant="ghost" icon={<Filter className="size-3.5" />} onClick={() => setMore((m) => !m)}>{more ? 'Fewer filters' : 'More filters'}</Button>
        <div className="flex gap-2">
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={reset}>Reset</Button>
          <Button size="sm" type="submit" variant="primary" icon={<Search className="size-3.5" />}>Search</Button>
        </div>
      </div>
    </form>
  );
}
