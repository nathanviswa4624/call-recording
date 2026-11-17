'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import type { ApplyResult, ConfigVersion } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';
import { ConfirmDialog, InlineAlert } from '@/components/ui/feedback';
import { ApplyResultView } from './apply-panel';

/**
 * Rollback button. Uses the backend's transactional rollback (POST
 * /config/versions/:id/rollback), which republishes the version as a new one and
 * restores the previous state if Asterisk rejects it. Only APPLIED versions qualify.
 */
export function RollbackButton({ version, onDone, rollback }: { version: ConfigVersion; onDone?: (r: ApplyResult) => void; rollback: (id: string) => Promise<ApplyResult> }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const m = useMutation({ mutationFn: () => rollback(version.id), onSuccess: (r) => { setOpen(false); void qc.invalidateQueries({ queryKey: ['config'] }); onDone?.(r); }, onError: () => setOpen(false) });
  if (!can(P.SYSTEM_MANAGE)) return null;
  const eligible = version.status === 'APPLIED' || version.status === 'ROLLED_BACK';
  return (
    <>
      <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} disabled={!eligible} title={eligible ? `Restore v${version.version}` : 'Only applied versions can be restored'} onClick={() => setOpen(true)}>Rollback</Button>
      <ConfirmDialog open={open} danger title={`Roll back to v${version.version}?`} confirmLabel="Roll back" loading={m.isPending} onCancel={() => setOpen(false)} onConfirm={() => m.mutate()} requireText={`v${version.version}`}>
        <p>The PJSIP realtime objects, generated dialplan and transports of <span className="font-medium text-text">v{version.version}</span> are re-published as a new version and Asterisk is reloaded.</p>
        <p>Draft objects in the UI are not changed; they will show as pending until you edit or re-apply them.</p>
        <p>If Asterisk rejects the restored configuration, the current configuration stays active.</p>
      </ConfirmDialog>
      {m.error && <InlineAlert tone="crit">{(m.error as Error).message}</InlineAlert>}
      {m.data && <div className="mt-2"><ApplyResultView result={m.data} /></div>}
    </>
  );
}
