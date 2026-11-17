'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, Plus } from 'lucide-react';
import { ALL_PERMISSIONS, PERMISSIONS as P } from '@echelons/shared';
import { userApi } from '@/lib/api/audit';
import { errorMessage } from '@/lib/api/client';
import { PermissionGuard } from '@/lib/auth';
import { PageHeader } from '@/components/ui/data';
import { Button, Card, Checkbox, Field, Input } from '@/components/ui/primitives';
import { Dialog, EmptyState, ErrorState, InlineAlert, LoadingState, useToast } from '@/components/ui/feedback';

export default function RolesPage() {
  return <PermissionGuard all={[P.USERS_MANAGE]} fallback={<EmptyState title="Not permitted" />}><RolesInner /></PermissionGuard>;
}

function RolesInner() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: userApi.roles });
  const [d, setD] = useState<{ code: string; name: string; description: string; permissions: string[] } | null>(null);
  const create = useMutation({ mutationFn: () => userApi.createRole({ ...d!, description: d!.description || null }), onSuccess: () => { toast.success('Role created'); setD(null); void qc.invalidateQueries({ queryKey: ['roles'] }); } });
  return (
    <div className="space-y-4">
      <PageHeader title="Roles & Permissions" description="Built-in roles cannot be modified. Create custom roles from the fixed permission set; the backend enforces every permission."
        actions={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setD({ code: '', name: '', description: '', permissions: [] })}>Custom role</Button>} />
      <Card bodyClassName="p-0 overflow-x-auto">
        {roles.isLoading ? <LoadingState /> : roles.error ? <ErrorState error={roles.error} onRetry={() => roles.refetch()} /> : (
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-border bg-surface-2"><th scope="col" className="px-3 py-2 text-left text-[11px] text-muted uppercase">Permission</th>{roles.data!.map((r) => <th scope="col" key={r.id} className="px-2 py-2 text-center text-[11px] whitespace-nowrap text-muted">{r.name}</th>)}</tr></thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal">{perm}</th>
                  {roles.data!.map((r) => <td key={r.id} className="text-center">{r.permissions.includes(perm) ? <Check className="mx-auto size-3.5 text-ok" aria-label="granted" /> : <Minus className="mx-auto size-3.5 text-border-strong" aria-label="not granted" />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog open={Boolean(d)} onClose={() => setD(null)} width="lg" title="Create custom role"
        footer={<><Button onClick={() => setD(null)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!d?.code || !d?.name || !d?.permissions.length} onClick={() => create.mutate()}>Create</Button></>}>
        {d && <div className="space-y-3">
          {create.error && <InlineAlert tone="crit">{errorMessage(create.error)}</InlineAlert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" help="UPPER_CASE">{(id) => <Input id={id} className="font-mono" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} />}</Field>
            <Field label="Name">{(id) => <Input id={id} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
            <Field label="Description" className="col-span-2">{(id) => <Input id={id} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
          </div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">{ALL_PERMISSIONS.map((p) => <Checkbox key={p} label={<span className="font-mono text-[12px]">{p}</span>} checked={d.permissions.includes(p)} onChange={(v) => setD({ ...d, permissions: v ? [...d.permissions, p] : d.permissions.filter((x) => x !== p) })} />)}</div>
        </div>}
      </Dialog>
    </div>
  );
}
