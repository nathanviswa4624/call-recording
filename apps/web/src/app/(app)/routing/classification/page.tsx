'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { CLASSIFICATION_FIELDS, CONDITION_OPS, PERMISSIONS as P } from '@echelons/shared';
import { routeApi } from '@/lib/api/routes';
import { errorDetails, errorMessage } from '@/lib/api/client';
import type { CallType, ClassificationRule } from '@/lib/api/types';
import { useAuth } from '@/lib/auth';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, Checkbox, DefinitionList, Field, Input, Select } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, InlineAlert, StatusBadge, useToast } from '@/components/ui/feedback';

type Cond = { field: string; op: string; value: string; header: string };
interface RuleDraft { id?: string; name: string; priority: number; enabled: boolean; match: 'all' | 'any'; stop: boolean; conditions: Cond[]; callTypeCode: string; direction: string; tags: string }

const blank = (): RuleDraft => ({ name: '', priority: 100, enabled: true, match: 'all', stop: true, conditions: [{ field: 'destinationNumber', op: 'matches', value: '', header: '' }], callTypeCode: '', direction: '', tags: '' });
function toDraft(r: ClassificationRule): RuleDraft {
  return {
    id: r.id, name: r.name, priority: r.priority, enabled: r.enabled, match: r.match, stop: r.stop,
    conditions: r.conditions.map((c) => ({ field: c.field, op: c.op, header: c.header ?? '', value: Array.isArray(c.value) ? c.value.join(', ') : c.value === undefined ? '' : String(c.value) })),
    callTypeCode: r.actions.callTypeCode ?? '', direction: r.actions.direction ?? '', tags: (r.actions.tags ?? []).join(', '),
  };
}
function toBody(d: RuleDraft): Omit<ClassificationRule, 'id'> {
  return {
    name: d.name, priority: Number(d.priority), enabled: d.enabled, match: d.match, stop: d.stop,
    conditions: d.conditions.map((c) => {
      const base: ClassificationRule['conditions'][number] = { field: c.field, op: c.op };
      if (c.field === 'sipHeader') base.header = c.header;
      if (c.op === 'exists' || c.op === 'notExists') return base;
      if (c.op === 'in' || c.op === 'notIn') return { ...base, value: c.value.split(',').map((s) => s.trim()).filter(Boolean) };
      if (['gt', 'gte', 'lt', 'lte'].includes(c.op) || ['billsec', 'duration'].includes(c.field)) return { ...base, value: Number(c.value) };
      if (['callerIsExtension', 'destinationIsExtension'].includes(c.field)) return { ...base, value: c.value === 'true' };
      return { ...base, value: c.value };
    }),
    actions: { ...(d.callTypeCode ? { callTypeCode: d.callTypeCode } : {}), ...(d.direction ? { direction: d.direction } : {}), ...(d.tags ? { tags: d.tags.split(',').map((s) => s.trim()).filter(Boolean) } : {}) },
  };
}
const describe = (c: ClassificationRule['conditions'][number]) => `${c.field}${c.header ? `[${c.header}]` : ''} ${c.op} ${c.value === undefined ? '' : Array.isArray(c.value) ? c.value.join('|') : String(c.value)}`;

export default function ClassificationPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const rules = useQuery({ queryKey: ['classification-rules'], queryFn: routeApi.rules });
  const types = useQuery({ queryKey: ['call-types'], queryFn: routeApi.callTypes });
  const [edit, setEdit] = useState<RuleDraft | null>(null);
  const [del, setDel] = useState<ClassificationRule | null>(null);
  const [newType, setNewType] = useState<{ code: string; name: string; color: string } | null>(null);
  const [sample, setSample] = useState({ direction: 'UNKNOWN', callerNumber: '201', destinationNumber: '90501234567', disposition: 'ANSWERED', billsec: 60 });
  const editable = can(P.ROUTES_CONFIGURE);

  const save = useMutation({
    mutationFn: () => (edit!.id ? routeApi.updateRule(edit!.id, toBody(edit!)) : routeApi.createRule(toBody(edit!))),
    onSuccess: () => { toast.success('Rule saved', 'Applies to calls imported from now on.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['classification-rules'] }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => routeApi.removeRule(id), onSuccess: () => { setDel(null); void qc.invalidateQueries({ queryKey: ['classification-rules'] }); }, onError: (e) => toast.error('Delete failed', e) });
  const createType = useMutation({ mutationFn: () => routeApi.createCallType({ code: newType!.code, name: newType!.name, color: newType!.color || null }), onSuccess: () => { setNewType(null); void qc.invalidateQueries({ queryKey: ['call-types'] }); } });
  const test = useMutation({ mutationFn: () => routeApi.testRules(sample) });

  return (
    <div className="space-y-4">
      <PageHeader title="Call Classification" description="Rules evaluated in priority order when each call record is imported. The first matching rule with a call type wins."
        actions={editable && <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { save.reset(); setEdit(blank()); }}>Add rule</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card bodyClassName="p-0" className="xl:col-span-2" title="Rules">
          <DataTable<ClassificationRule> rows={rules.data} loading={rules.isLoading} error={rules.error} onRetry={() => rules.refetch()} rowKey={(r) => r.id}
            empty={{ icon: Tags, title: 'No classification rules', description: 'Without rules, calls are typed by direction and answer status (Inbound, Outbound, Missed, Failed…).' }}
            columns={[
              { key: 'p', header: 'Prio', align: 'right', sort: (r) => r.priority, cell: (r) => r.priority },
              { key: 'n', header: 'Rule', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11.5px] text-muted">{r.match.toUpperCase()}: {r.conditions.map(describe).join(r.match === 'all' ? ' AND ' : ' OR ')}</p></div> },
              { key: 'a', header: 'Sets', cell: (r) => [r.actions.callTypeCode, r.actions.direction, ...(r.actions.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' · ') || '—' },
              { key: 's', header: 'Stop', cell: (r) => (r.stop ? 'yes' : 'no') },
              { key: 'e', header: 'Status', cell: (r) => (r.enabled ? <StatusBadge tone="ok">Enabled</StatusBadge> : <StatusBadge tone="neutral">Disabled</StatusBadge>) },
              { key: 'x', header: '', align: 'right', cell: (r) => editable ? <div className="flex justify-end gap-0.5"><Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} icon={<Pencil className="size-3.5" />} onClick={() => { save.reset(); setEdit(toDraft(r)); }} /><Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(r)} /></div> : null },
            ]} />
        </Card>
        <div className="space-y-4">
          <Card title="Test rules" actions={<Button size="sm" icon={<FlaskConical className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>Classify</Button>}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Caller">{(id) => <Input id={id} value={sample.callerNumber} onChange={(e) => setSample({ ...sample, callerNumber: e.target.value })} />}</Field>
              <Field label="Destination">{(id) => <Input id={id} value={sample.destinationNumber} onChange={(e) => setSample({ ...sample, destinationNumber: e.target.value })} />}</Field>
              <Field label="Direction">{(id) => <Select id={id} value={sample.direction} onChange={(e) => setSample({ ...sample, direction: e.target.value })}>{['UNKNOWN', 'INBOUND', 'OUTBOUND', 'INTERNAL'].map((d) => <option key={d}>{d}</option>)}</Select>}</Field>
              <Field label="Disposition">{(id) => <Select id={id} value={sample.disposition} onChange={(e) => setSample({ ...sample, disposition: e.target.value })}>{['ANSWERED', 'NO ANSWER', 'BUSY', 'FAILED'].map((d) => <option key={d}>{d}</option>)}</Select>}</Field>
            </div>
            {test.data && <div className="mt-3"><DefinitionList columns={2} items={[['Call type', test.data.callTypeCode], ['Status', test.data.answerStatus], ['Direction', test.data.direction], ['Rules matched', test.data.matchedRuleIds.length]]} /></div>}
            {test.error && <InlineAlert tone="crit">{errorMessage(test.error)}</InlineAlert>}
          </Card>
          <Card title="Call types" actions={editable && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setNewType({ code: '', name: '', color: '#2a78d6' })}>Custom type</Button>}>
            <ul className="flex flex-wrap gap-1.5">{types.data?.map((t: CallType) => <li key={t.id} className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 text-[12px]">{t.color && <span className="size-2 rounded-full" style={{ background: t.color }} />}{t.name}<span className="font-mono text-[10.5px] text-muted">{t.code}</span></li>)}</ul>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} width="lg" title={edit?.id ? 'Edit rule' : 'Add rule'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!edit?.name || !edit?.conditions.length} onClick={() => save.mutate()}>Save</Button></>}>
        {edit && (
          <div className="space-y-3">
            {save.error && <InlineAlert tone="crit" title="Invalid rule">{errorMessage(save.error)}{errorDetails(save.error).map((d, i) => <div key={i}>{d.path} {d.message}</div>)}</InlineAlert>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Name" required className="col-span-2">{(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
              <Field label="Priority">{(id) => <Input id={id} type="number" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} />}</Field>
              <Field label="Match">{(id) => <Select id={id} value={edit.match} onChange={(e) => setEdit({ ...edit, match: e.target.value as 'all' | 'any' })}><option value="all">All conditions</option><option value="any">Any condition</option></Select>}</Field>
            </div>
            {edit.conditions.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? 'Field' : ''}>{(id) => <Select id={id} value={c.field} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>{CLASSIFICATION_FIELDS.map((f) => <option key={f}>{f}</option>)}</Select>}</Field>
                <Field label={i === 0 ? 'Operator' : ''}>{(id) => <Select id={id} value={c.op} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>{CONDITION_OPS.map((o) => <option key={o}>{o}</option>)}</Select>}</Field>
                <Field label={i === 0 ? 'Value' : ''}>{(id) => <Input id={id} className="font-mono" placeholder={c.field === 'sipHeader' ? 'header=value' : c.op === 'matches' ? '9XXXXXXXXXX' : ''} value={c.field === 'sipHeader' && c.header ? c.value : c.value} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}</Field>
                <Button size="sm" variant="ghost" aria-label="Remove condition" icon={<Trash2 className="size-3.5" />} disabled={edit.conditions.length === 1} onClick={() => setEdit({ ...edit, conditions: edit.conditions.filter((_, j) => j !== i) })} />
                {c.field === 'sipHeader' && <Field label="Header name" className="col-span-4">{(id) => <Input id={id} value={c.header} onChange={(e) => setEdit({ ...edit, conditions: edit.conditions.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)) })} placeholder="X-Avaya-Conf-Id" />}</Field>}
              </div>
            ))}
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ ...edit, conditions: [...edit.conditions, { field: 'callerNumber', op: 'eq', value: '', header: '' }] })}>Add condition</Button>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 md:grid-cols-3">
              <Field label="Set call type">{(id) => <Select id={id} value={edit.callTypeCode} onChange={(e) => setEdit({ ...edit, callTypeCode: e.target.value })}><option value="">—</option>{types.data?.map((t) => <option key={t.id} value={t.code}>{t.name}</option>)}</Select>}</Field>
              <Field label="Set direction">{(id) => <Select id={id} value={edit.direction} onChange={(e) => setEdit({ ...edit, direction: e.target.value })}><option value="">—</option>{['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT'].map((d) => <option key={d}>{d}</option>)}</Select>}</Field>
              <Field label="Add tags" help="Comma-separated">{(id) => <Input id={id} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />}</Field>
            </div>
            <div className="flex gap-4"><Checkbox label="Enabled" checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} /><Checkbox label="Stop after match" checked={edit.stop} onChange={(v) => setEdit({ ...edit, stop: v })} /></div>
          </div>
        )}
      </Dialog>
      <Dialog open={Boolean(newType)} onClose={() => setNewType(null)} title="Custom call type" width="sm" footer={<><Button onClick={() => setNewType(null)}>Cancel</Button><Button variant="primary" loading={createType.isPending} onClick={() => createType.mutate()}>Create</Button></>}>
        {newType && <div className="space-y-3">
          {createType.error && <InlineAlert tone="crit">{errorMessage(createType.error)}</InlineAlert>}
          <Field label="Code" help="UPPER_CASE, e.g. VIP_GUEST">{(id) => <Input id={id} className="font-mono" value={newType.code} onChange={(e) => setNewType({ ...newType, code: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Name">{(id) => <Input id={id} value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />}</Field>
          <Field label="Color">{(id) => <Input id={id} type="color" value={newType.color} onChange={(e) => setNewType({ ...newType, color: e.target.value })} />}</Field>
        </div>}
      </Dialog>
      <ConfirmDialog open={Boolean(del)} danger title="Delete rule?" confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)}>
        <p>Already-imported calls keep their current classification.</p>
      </ConfirmDialog>
    </div>
  );
}
