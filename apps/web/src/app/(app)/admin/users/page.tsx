'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Users } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { userApi } from '@/lib/api/audit';
import { pbxApi } from '@/lib/api/pbx';
import { errorDetails, errorMessage } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { passwordPolicy } from '@/lib/validation';
import { fmtDateTime } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, Checkbox, Field, Input, Select } from '@/components/ui/primitives';
import { Dialog, EmptyState, InlineAlert, StatusText, useToast } from '@/components/ui/feedback';

interface Draft { id?: string; username: string; email: string; displayName: string; password: string; roleIds: string[]; siteIds: string[]; extensions: string; department: string; status: 'ACTIVE' | 'DISABLED' }
const blank = (): Draft => ({ username: '', email: '', displayName: '', password: '', roleIds: [], siteIds: [], extensions: '', department: '', status: 'ACTIVE' });

export default function UsersPage() {
  return <PermissionGuard all={[P.USERS_MANAGE]} fallback={<EmptyState title="Not permitted" description="User management requires users.manage." />}><UsersInner /></PermissionGuard>;
}

function UsersInner() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: userApi.list });
  const roles = useQuery({ queryKey: ['roles'], queryFn: userApi.roles });
  const sites = useQuery({ queryKey: ['sites'], queryFn: pbxApi.sites });
  const [d, setD] = useState<Draft | null>(null);
  const pwErr = d?.password ? passwordPolicy(d.password) : null;
  const save = useMutation({
    mutationFn: () => {
      const b = { username: d!.username, email: d!.email, displayName: d!.displayName, roleIds: d!.roleIds, siteIds: d!.siteIds, extensions: d!.extensions.split(',').map((s) => s.trim()).filter(Boolean), department: d!.department || null, status: d!.status, ...(d!.password ? { password: d!.password } : {}) };
      return d!.id ? userApi.update(d!.id, b) : userApi.create(b);
    },
    onSuccess: () => { toast.success('User saved'); setD(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Users" description="Accounts in your organization. Agents see only recordings of their own extensions or explicitly granted calls." actions={<Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { save.reset(); setD(blank()); }}>Add user</Button>} />
      <Card bodyClassName="p-0">
        <DataTable<User> rows={users.data} loading={users.isLoading} error={users.error} onRetry={() => users.refetch()} rowKey={(u) => u.id}
          empty={{ icon: Users, title: 'No users' }}
          columns={[
            { key: 'n', header: 'Name', sort: (u) => u.displayName, cell: (u) => <div><p className="font-medium">{u.displayName}</p><p className="text-[12px] text-muted">{u.username} · {u.email}</p></div> },
            { key: 'r', header: 'Roles', cell: (u) => u.roles.map((r) => r.role.name).join(', ') },
            { key: 'e', header: 'Extensions', cell: (u) => u.extensions.join(', ') || '—' },
            { key: 's', header: 'Sites', cell: (u) => (u.siteAccess.length ? u.siteAccess.map((s) => sites.data?.find((x) => x.id === s.siteId)?.name ?? '?').join(', ') : 'All') },
            { key: 'm', header: 'MFA', cell: (u) => (u.mfaEnabled ? 'On' : 'Off') },
            { key: 'l', header: 'Last login', sort: (u) => u.lastLoginAt ?? '', cell: (u) => fmtDateTime(u.lastLoginAt) },
            { key: 'st', header: 'Status', cell: (u) => <StatusText status={u.status} /> },
            { key: 'a', header: '', align: 'right', cell: (u) => <Button size="sm" variant="ghost" aria-label={`Edit ${u.username}`} icon={<Pencil className="size-3.5" />} onClick={() => { save.reset(); setD({ id: u.id, username: u.username, email: u.email, displayName: u.displayName, password: '', roleIds: u.roles.map((r) => r.role.id), siteIds: u.siteAccess.map((s) => s.siteId), extensions: u.extensions.join(', '), department: u.department ?? '', status: u.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE' }); }} /> },
          ]} />
      </Card>
      <Dialog open={Boolean(d)} onClose={() => setD(null)} width="lg" title={d?.id ? `Edit ${d.username}` : 'Add user'}
        footer={<><Button onClick={() => setD(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!d?.username || !d?.email || !d?.roleIds.length || (!d?.id && !d?.password) || Boolean(pwErr)} onClick={() => save.mutate()}>Save</Button></>}>
        {d && (
          <div className="space-y-3">
            {save.error && <InlineAlert tone="crit">{errorMessage(save.error)}{errorDetails(save.error).map((x, i) => <div key={i}>{x.path} {x.message}</div>)}</InlineAlert>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Username" required>{(id) => <Input id={id} value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} autoComplete="off" />}</Field>
              <Field label="Email" required>{(id) => <Input id={id} type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />}</Field>
              <Field label="Display name" required>{(id) => <Input id={id} value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} />}</Field>
              <Field label={d.id ? 'New password (optional)' : 'Password'} required={!d.id} error={pwErr ?? undefined} help={d.id ? 'Setting a password signs the user out everywhere.' : '12+ characters, 3 character classes'}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />}</Field>
              <Field label="Extensions" help="Agent's own extensions (comma-separated)">{(id) => <Input id={id} value={d.extensions} onChange={(e) => setD({ ...d, extensions: e.target.value })} />}</Field>
              <Field label="Department">{(id) => <Input id={id} value={d.department} onChange={(e) => setD({ ...d, department: e.target.value })} />}</Field>
              <Field label="Status">{(id) => <Select id={id} value={d.status} disabled={d.id === me?.id} onChange={(e) => setD({ ...d, status: e.target.value as Draft['status'] })}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></Select>}</Field>
            </div>
            <fieldset><legend className="mb-1 text-xs font-medium text-text-2">Roles *</legend><div className="flex flex-wrap gap-3">{roles.data?.map((r) => <Checkbox key={r.id} label={r.name} checked={d.roleIds.includes(r.id)} onChange={(v) => setD({ ...d, roleIds: v ? [...d.roleIds, r.id] : d.roleIds.filter((x) => x !== r.id) })} />)}</div></fieldset>
            <fieldset><legend className="mb-1 text-xs font-medium text-text-2">Site restriction (none selected = all sites)</legend><div className="flex flex-wrap gap-3">{sites.data?.map((s) => <Checkbox key={s.id} label={s.name} checked={d.siteIds.includes(s.id)} onChange={(v) => setD({ ...d, siteIds: v ? [...d.siteIds, s.id] : d.siteIds.filter((x) => x !== s.id) })} />)}</div></fieldset>
          </div>
        )}
      </Dialog>
    </div>
  );
}
