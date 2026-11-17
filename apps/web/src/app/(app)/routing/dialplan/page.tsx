'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2, ListTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { ALLOWED_APPLICATIONS, PERMISSIONS as P } from '@echelons/shared';
import { routeApi } from '@/lib/api/routes';
import { configApi } from '@/lib/api/config';
import { errorDetails, errorMessage } from '@/lib/api/client';
import type { DialplanContext } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, EmptyState, InlineAlert, LoadingState, StatusBadge, useToast } from '@/components/ui/feedback';
import { ApplyPanel, IssueList } from '@/components/domain/apply-panel';

interface Prio { app: string; args: string; label: string }
interface Ext { exten: string; priorities: Prio[] }
interface Ctx { id?: string; name: string; description: string; includes: string; extensions: Ext[] }

const blank = (): Ctx => ({ name: '', description: '', includes: '', extensions: [{ exten: '_X.', priorities: [{ app: 'NoOp', args: 'Call to ${EXTEN}', label: '' }, { app: 'Hangup', args: '', label: '' }] }] });
const fromCtx = (c: DialplanContext): Ctx => ({ id: c.id, name: c.name, description: c.description ?? '', includes: c.includes.join(', '), extensions: c.extensions.map((e) => ({ exten: e.exten, priorities: e.priorities.map((p) => ({ app: p.app, args: p.args, label: p.label ?? '' })) })) });

export default function DialplanPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const { serverId } = useServer();
  const list = useQuery({ queryKey: ['dialplans', serverId], queryFn: () => routeApi.dialplans(serverId!), enabled: Boolean(serverId) });
  const preview = useQuery({ queryKey: ['config', 'dialplan', serverId], queryFn: () => configApi.previewDialplan(serverId!), enabled: false });
  const [edit, setEdit] = useState<Ctx | null>(null);
  const [del, setDel] = useState<DialplanContext | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const editable = can(P.DIALPLAN_CONFIGURE);

  const save = useMutation({
    mutationFn: () => {
      const b = { serverId, name: edit!.name, description: edit!.description || null, includes: edit!.includes.split(',').map((s) => s.trim()).filter(Boolean), extensions: edit!.extensions.map((e) => ({ exten: e.exten.trim(), priorities: e.priorities.map((p) => ({ app: p.app, args: p.args, label: p.label || null })) })) };
      return edit!.id ? routeApi.updateDialplan(edit!.id, b) : routeApi.createDialplan(b);
    },
    onSuccess: () => { toast.success('Dialplan context saved as draft', 'Apply the configuration to load it into Asterisk.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['dialplans'] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => routeApi.removeDialplan(id),
    onSuccess: () => { toast.success('Context deleted (draft)'); setDel(null); void qc.invalidateQueries({ queryKey: ['dialplans'] }); },
    onError: (e) => { toast.error('Delete failed', e); setDel(null); },
  });

  if (!serverId) return <EmptyState title="No Asterisk server selected" />;
  const upExt = (i: number, patch: Partial<Ext>) => setEdit({ ...edit!, extensions: edit!.extensions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="space-y-4">
      <PageHeader title="Dialplan" description="Custom contexts compiled into extensions_echelons.conf together with the generated trunk and route contexts. Applications are limited to a safe allowlist."
        actions={<>
          <Button icon={<FileCode2 className="size-3.5" />} onClick={() => { setShowPreview(true); void preview.refetch(); }}>Generated dialplan</Button>
          {editable && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { save.reset(); setEdit(blank()); }}>Create context</Button>}
        </>} />
      <Card bodyClassName="p-0">
        <DataTable<DialplanContext> rows={list.data} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} rowKey={(c) => c.id}
          empty={{ icon: ListTree, title: 'No custom contexts', description: 'Trunk and route contexts are generated automatically. Add custom contexts for internal extensions, IVRs or special handling.' }}
          columns={[
            { key: 'n', header: 'Context', sort: (c) => c.name, cell: (c) => <span className="font-mono font-medium">{c.name}</span> },
            { key: 'd', header: 'Description', cell: (c) => c.description ?? '—' },
            { key: 'e', header: 'Extensions', align: 'right', cell: (c) => c.extensions.length },
            { key: 'i', header: 'Includes', cell: (c) => c.includes.join(', ') || '—' },
            { key: 'o', header: 'Source', cell: (c) => (c.readOnly ? <StatusBadge tone="neutral" icon={false}>Imported (read-only)</StatusBadge> : <span className="text-text-2">Managed</span>) },
            {
              key: 'a', header: '', align: 'right', cell: (c) => editable && !c.readOnly ? (
                <div className="flex justify-end gap-0.5">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${c.name}`} icon={<Pencil className="size-3.5" />} onClick={() => { save.reset(); setEdit(fromCtx(c)); }} />
                  <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(c)} />
                </div>
              ) : null,
            },
          ]} />
      </Card>
      {editable && <ApplyPanel serverId={serverId} />}

      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} width="xl" title={edit?.id ? `Edit context ${edit.name}` : 'Create context'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.name} onClick={() => save.mutate()}>Save draft</Button></>}>
        {edit && (
          <div className="space-y-3">
            {save.error && <InlineAlert tone="crit" title="Invalid dialplan">{errorMessage(save.error)}<ul>{errorDetails(save.error).map((d, i) => <li key={i}>{d.object ?? d.path} {d.message}</li>)}</ul></InlineAlert>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Context name" required help={'Must not start with "ech-"'}>{(id) => <Input id={id} className="font-mono" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
              <Field label="Description">{(id) => <Input id={id} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
              <Field label="Includes" help="Comma-separated context names">{(id) => <Input id={id} className="font-mono" value={edit.includes} onChange={(e) => setEdit({ ...edit, includes: e.target.value })} />}</Field>
            </div>
            {edit.extensions.map((ext, i) => (
              <div key={i} className="rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-2 py-1.5">
                  <span className="text-[12px] text-muted">exten =&gt;</span>
                  <Input aria-label="Extension" className="w-48 font-mono" value={ext.exten} onChange={(e) => upExt(i, { exten: e.target.value })} />
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={edit.extensions.length === 1} onClick={() => setEdit({ ...edit, extensions: edit.extensions.filter((_, j) => j !== i) })}>Remove extension</Button>
                </div>
                <div className="space-y-1 p-2">
                  {ext.priorities.map((p, k) => (
                    <div key={k} className="grid grid-cols-[3rem_8rem_10rem_1fr_auto] items-center gap-1.5">
                      <span className="text-right text-[12px] text-muted tabular">{k === 0 ? '1' : 'n'}</span>
                      <Input aria-label="Label" placeholder="label" className="font-mono" value={p.label} onChange={(e) => upExt(i, { priorities: ext.priorities.map((x, m) => (m === k ? { ...x, label: e.target.value } : x)) })} />
                      <Select aria-label="Application" value={p.app} onChange={(e) => upExt(i, { priorities: ext.priorities.map((x, m) => (m === k ? { ...x, app: e.target.value } : x)) })}>
                        {ALLOWED_APPLICATIONS.map((a) => <option key={a}>{a}</option>)}
                      </Select>
                      <Input aria-label="Arguments" className="font-mono" value={p.args} onChange={(e) => upExt(i, { priorities: ext.priorities.map((x, m) => (m === k ? { ...x, args: e.target.value } : x)) })} />
                      <Button size="sm" variant="ghost" aria-label="Remove step" icon={<Trash2 className="size-3.5" />} disabled={ext.priorities.length === 1} onClick={() => upExt(i, { priorities: ext.priorities.filter((_, m) => m !== k) })} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => upExt(i, { priorities: [...ext.priorities, { app: 'NoOp', args: '', label: '' }] })}>Add step</Button>
                </div>
              </div>
            ))}
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ ...edit, extensions: [...edit.extensions, { exten: '', priorities: [{ app: 'Answer', args: '', label: '' }] }] })}>Add extension</Button>
          </div>
        )}
      </Dialog>
      <Dialog open={showPreview} onClose={() => setShowPreview(false)} width="xl" title="Generated dialplan (current drafts)">
        {preview.isFetching ? <LoadingState /> : preview.error ? <InlineAlert tone="crit">{errorMessage(preview.error)}</InlineAlert> : preview.data && (
          <div className="space-y-2"><IssueList issues={preview.data.issues} /><pre className="max-h-[60vh] overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[12px]">{preview.data.text}</pre></div>
        )}
      </Dialog>
      <ConfirmDialog open={Boolean(del)} danger title="Delete context?" confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)}>
        <p>Deletes <span className="font-mono text-text">{del?.name}</span>. The backend refuses if a route sends calls to it.</p>
      </ConfirmDialog>
    </div>
  );
}
