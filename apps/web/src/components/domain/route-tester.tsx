'use client';
/**
 * Route tester. Uses the backend dry-run (POST /route-patterns/test), which runs
 * the shared selectRoute() — the same precedence the generated dialplan gives
 * Asterisk (priority tiers via ordered includes, then Asterisk specificity).
 */
import { useState, type FormEvent } from 'react';
import { TestTube2 } from 'lucide-react';
import type { Pbx, RouteTestResult } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/client';
import { Button, DefinitionList, Field, Input, Select } from '@/components/ui/primitives';
import { InlineAlert } from '@/components/ui/feedback';

export function RouteTestSummary({ r }: { r: RouteTestResult }) {
  if (!r.matched) return <InlineAlert tone="warn" title="No matching route">{r.considered} enabled pattern(s) were checked for this PBX.</InlineAlert>;
  return (
    <InlineAlert tone="ok" title={`Matched route: ${r.route.name}`}>
      <span className="font-mono">{r.pattern.pattern}</span> · priority {r.route.priority} · dials <span className="font-mono">{r.dialled || '(empty)'}</span> via {r.egress.trunk ?? r.egress.context ?? r.egress.kind}
    </InlineAlert>
  );
}

export function RouteTestDetails({ r }: { r: Extract<RouteTestResult, { matched: true }> }) {
  const rec = r.recordingPolicy;
  const recording = rec.mode === 'NEVER' ? 'Disabled' : rec.mode === 'ALWAYS' ? 'Enabled' : rec.mode === 'ON_DEMAND' ? 'On demand' : rec.mode === 'INBOUND_ONLY' ? (r.route.direction === 'INBOUND' ? 'Enabled (inbound only)' : 'Disabled (inbound only)') : (r.route.direction === 'OUTBOUND' ? 'Enabled (outbound only)' : 'Disabled (outbound only)');
  return (
    <DefinitionList columns={3} items={[
      ['Matched route', `${r.route.name} (#${r.route.routeNumber})`],
      ['Pattern', <span key="p" className="font-mono">{r.pattern.pattern}</span>],
      ['Priority', r.route.priority],
      ['Direction', r.route.direction],
      ['Trunk / destination', r.egress.kind === 'TRUNK' ? r.egress.trunk : r.egress.kind === 'CONTEXT' ? `Context ${r.egress.context}` : 'Rejected (hang up)'],
      ['Prefix', r.prefix || '—'],
      ['Digits stripped', r.stripDigits],
      ['Prepended', r.prepend || '—'],
      ['Number sent', <span key="d" className="font-mono">{r.dialled || '(empty)'}</span>],
      ['Recording', `${recording} · ${rec.name} (${rec.layout === 'MIXED' ? 'mixed' : 'mixed + split'}, ${rec.format})`],
      ['Call type', r.callType?.name ?? 'Classified after the call'],
    ]} />
  );
}

export function RouteTester({ pbxs, onTest }: { pbxs: Pbx[]; onTest: (number: string, pbxId: string) => Promise<RouteTestResult> }) {
  const [number, setNumber] = useState('');
  const [pbxId, setPbxId] = useState(pbxs[0]?.id ?? '');
  const [result, setResult] = useState<RouteTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[0-9A-Za-z*#+]{1,64}$/.test(number)) { setError('Enter digits, *, # or + only'); return; }
    if (!pbxId) { setError('Select the PBX the call arrives from'); return; }
    setBusy(true); setError(null);
    try { setResult(await onTest(number, pbxId)); } catch (err) { setResult(null); setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Route tester">
        <Field label="Call arrives from PBX" className="w-64">{(id) => (
          <Select id={id} value={pbxId} onChange={(e) => setPbxId(e.target.value)}>
            {pbxs.length === 0 && <option value="">No PBX configured</option>}
            {pbxs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Dialled number" className="w-72">{(id) => <Input id={id} className="font-mono" value={number} onChange={(e) => setNumber(e.target.value.trim())} placeholder="971501234567" />}</Field>
        <Button type="submit" variant="primary" icon={<TestTube2 className="size-3.5" />} loading={busy}>Test route</Button>
      </form>
      {error && <InlineAlert tone="crit">{error}</InlineAlert>}
      {result && (result.matched ? (
        <div className="space-y-3"><RouteTestSummary r={result} /><RouteTestDetails r={result} /></div>
      ) : <InlineAlert tone="warn" title="No matching route">{`${result.considered} enabled pattern(s) checked. Calls to ${result.number} from this PBX would be rejected (CDR direction UNROUTED).`}</InlineAlert>)}
    </div>
  );
}
