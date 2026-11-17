'use client';
/**
 * Validate → preview → confirm → atomic apply, using the existing
 * ConfigurationService pipeline (/config/validate, /config/preview/dialplan,
 * /config/apply). Shows the backend's own rollback outcome on failure.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileCode2, ShieldCheck, UploadCloud } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { configApi } from '@/lib/api/config';
import type { ApplyIssue, ApplyResult } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { Button, Card, Field, Input } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, InlineAlert, LoadingState, StatusBadge } from '@/components/ui/feedback';

export function IssueList({ issues }: { issues: ApplyIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto text-[12.5px]">
      {issues.map((i, n) => (
        <li key={n} className="flex items-start gap-2">
          <StatusBadge tone={i.severity === 'error' ? 'crit' : 'warn'}>{i.severity}</StatusBadge>
          <span className="min-w-0"><span className="font-mono text-text">{i.object}{i.field ? `.${i.field}` : ''}</span> <span className="text-text-2">{i.message}</span></span>
        </li>
      ))}
    </ul>
  );
}

export function ApplyResultView({ result }: { result: ApplyResult }) {
  if (result.status === 'APPLIED') {
    return (
      <InlineAlert tone="ok" title={`Configuration v${result.version} applied`}>
        Asterisk reloaded and verified the new configuration.{result.restartRequired && ' Transport changes require an Asterisk restart to take effect.'}
        {result.issues.length > 0 && <div className="mt-2"><IssueList issues={result.issues} /></div>}
      </InlineAlert>
    );
  }
  if (result.status === 'NO_CHANGES') return <InlineAlert tone="info" title="No changes">The draft configuration is identical to the applied version{result.version ? ` (v${result.version})` : ''}.</InlineAlert>;
  if (result.status === 'VALIDATION_FAILED') {
    return <InlineAlert tone="crit" title="Validation failed — nothing was applied"><div className="mt-1"><IssueList issues={result.issues} /></div></InlineAlert>;
  }
  const rollback = result.steps.find((s) => s.step === 'rollback');
  const reason = result.issues.find((i) => i.object === 'asterisk')?.message ?? result.steps.find((s) => s.status === 'failed')?.message;
  return (
    <InlineAlert tone="crit" title="Configuration apply failed">
      <p>Asterisk rejected the configuration.</p>
      <p>{rollback?.status === 'ok' ? 'The previous configuration has been restored.' : `Rollback: ${rollback?.message ?? 'not required'}`}</p>
      {reason && <p className="mt-1"><span className="font-medium text-text">Reason:</span> {reason}</p>}
      {result.version && <p><span className="font-medium text-text">Version:</span> #{result.version}</p>}
    </InlineAlert>
  );
}

export function ApplyPanel({ serverId, summary: defaultSummary = '', onApplied }: { serverId: string; summary?: string; onApplied?: (r: ApplyResult) => void }) {
  const { canAny } = useAuth();
  const qc = useQueryClient();
  const allowed = canAny(P.TRUNKS_CONFIGURE, P.ENDPOINTS_CONFIGURE, P.ROUTES_CONFIGURE, P.DIALPLAN_CONFIGURE);
  const [summary, setSummary] = useState(defaultSummary);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const pending = useQuery({ queryKey: ['config', 'pending', serverId], queryFn: () => configApi.pending(serverId) });
  const validate = useMutation({ mutationFn: () => configApi.validate(serverId) });
  const dialplan = useQuery({ queryKey: ['config', 'dialplan', serverId], queryFn: () => configApi.previewDialplan(serverId), enabled: preview });
  const apply = useMutation({
    mutationFn: () => configApi.apply(serverId, summary || undefined),
    onSuccess: (r) => { setConfirm(false); void qc.invalidateQueries(); onApplied?.(r); },
    onError: () => setConfirm(false),
  });
  const p = pending.data;
  const pendingCount = p ? p.endpoints + p.aors + p.auths + p.identifies + p.registrations + p.transports : 0;

  return (
    <Card title="Validate & apply" actions={<Button size="sm" variant="ghost" icon={<FileCode2 className="size-3.5" />} onClick={() => setPreview(true)}>Generated dialplan</Button>}>
      <div className="space-y-3">
        {pending.isLoading ? <LoadingState /> : p && (
          <div className="flex flex-wrap gap-1.5 text-[12.5px]">
            {(['endpoints', 'aors', 'auths', 'identifies', 'registrations', 'transports'] as const).map((k) => (
              <StatusBadge key={k} tone={p[k] ? 'warn' : 'neutral'} icon={false}>{p[k]} {k} pending</StatusBadge>
            ))}
            <span className="text-muted">{p.lastApplied ? `Last applied: v${p.lastApplied.version}` : 'Nothing applied yet'} · route/dialplan changes are detected at apply time</span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Button icon={<ShieldCheck className="size-3.5" />} loading={validate.isPending} onClick={() => validate.mutate()}>Validate</Button>
          <Field label="Change summary" className="min-w-64 flex-1">{(id) => <Input id={id} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Add Avaya trunk and mobile route" maxLength={500} />}</Field>
          <Button variant="primary" icon={<UploadCloud className="size-3.5" />} disabled={!allowed} title={allowed ? undefined : 'Requires a configure permission'} onClick={() => setConfirm(true)}>Apply to Asterisk</Button>
        </div>
        {validate.data && (validate.data.ok
          ? <InlineAlert tone="ok" title={`Validation passed${pendingCount ? '' : ''}`}>{validate.data.issues.length ? <IssueList issues={validate.data.issues} /> : 'No errors or warnings.'}</InlineAlert>
          : <InlineAlert tone="crit" title="Validation failed"><IssueList issues={validate.data.issues} /></InlineAlert>)}
        {validate.error && <InlineAlert tone="crit">{(validate.error as Error).message}</InlineAlert>}
        {apply.data && <ApplyResultView result={apply.data} />}
        {apply.error && <InlineAlert tone="crit" title="Apply request failed">{(apply.error as Error).message}</InlineAlert>}
        {apply.data?.versionId && <p className="text-[12.5px]"><Link className="text-primary hover:underline" href="/config/versions">View configuration versions</Link></p>}
      </div>
      <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} onConfirm={() => apply.mutate()} loading={apply.isPending} title="Apply configuration to Asterisk?" confirmLabel="Apply">
        <p>The backend will validate, snapshot the current configuration, publish PJSIP objects to the Sorcery realtime tables and the generated dialplan in one operation, reload and verify.</p>
        <p className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-ok" />If Asterisk rejects anything, the previous configuration is restored automatically.</p>
      </ConfirmDialog>
      <Dialog open={preview} onClose={() => setPreview(false)} title="Generated dialplan (preview)" width="xl">
        {dialplan.isLoading ? <LoadingState /> : dialplan.error ? <InlineAlert tone="crit">{(dialplan.error as Error).message}</InlineAlert> : dialplan.data && (
          <div className="space-y-2">
            <IssueList issues={dialplan.data.issues} />
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">{dialplan.data.text}</pre>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
