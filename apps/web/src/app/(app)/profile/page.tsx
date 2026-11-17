'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { passwordPolicy } from '@/lib/validation';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList, Field, Input } from '@/components/ui/primitives';
import { ErrorState, InlineAlert, LoadingState, useToast } from '@/components/ui/feedback';

export default function ProfilePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: authApi.me });
  const { logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const policy = next ? passwordPolicy(next) : null;
  const change = useMutation({
    mutationFn: () => authApi.changePassword(cur, next),
    onSuccess: async () => {
      toast.success('Password changed', 'All sessions were signed out. Sign in with your new password.');
      await logout();
    },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile" description="Your account and password." />
      <div className="space-y-4">
        <Card title="Account">
          {me.isLoading ? <LoadingState /> : me.error ? <ErrorState error={me.error} onRetry={() => me.refetch()} /> : (
            <DefinitionList items={[
              ['Name', me.data!.name], ['Username', me.data!.username], ['Email', me.data!.email], ['Organization', me.data!.organization?.name],
              ['Extensions', me.data!.extensions?.join(', ') || '—'], ['Department', me.data!.department], ['MFA', me.data!.mfaEnabled ? 'Enabled' : 'Not enabled'],
              ['Permissions', `${me.data!.permissions.length} granted`],
            ]} />
          )}
        </Card>
        <Card title="Change password">
          <form className="grid max-w-md gap-3" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
            {change.error && <InlineAlert tone="crit">{(change.error as Error).message}</InlineAlert>}
            <Field label="Current password" required>{(id) => <Input id={id} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
            <Field label="New password" required error={policy ?? undefined} help="12+ characters, 3 of: lowercase, uppercase, digit, symbol">{(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
            <Field label="Confirm new password" required error={confirm && confirm !== next ? 'Passwords do not match' : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
            <div><Button type="submit" variant="primary" icon={<KeyRound className="size-3.5" />} loading={change.isPending} disabled={!cur || !next || Boolean(policy) || confirm !== next}>Change password</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}
