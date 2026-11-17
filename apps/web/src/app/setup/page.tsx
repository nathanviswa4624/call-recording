'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AudioWaveform, CheckCircle2, PlugZap } from 'lucide-react';
import { setupApi } from '@/lib/api/audit';
import { errorDetails } from '@/lib/api/client';
import { passwordPolicy } from '@/lib/validation';
import { Button, Card, Field, Input } from '@/components/ui/primitives';
import { ErrorState, InlineAlert, LoadingState, StatusBadge } from '@/components/ui/feedback';

/** First-run installation wizard (spec §46). The backend locks these endpoints once installed. */
export default function SetupPage() {
  const status = useQuery({ queryKey: ['setup', 'status'], queryFn: setupApi.status, retry: false });
  const test = useMutation({ mutationFn: setupApi.test });
  const complete = useMutation({ mutationFn: setupApi.complete });
  const [f, setF] = useState({ orgName: '', orgSlug: '', siteName: 'Main site', siteCode: 'MAIN', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC', serverName: 'asterisk-1', username: 'admin', email: '', displayName: 'Administrator', password: '', confirm: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pwError = f.password ? passwordPolicy(f.password) : null;
  const errors: Record<string, string | undefined> = {
    orgSlug: f.orgSlug && !/^[a-z0-9-]{2,64}$/.test(f.orgSlug) ? 'Lowercase letters, digits and dashes' : undefined,
    siteCode: f.siteCode && !/^[A-Za-z0-9_-]{1,32}$/.test(f.siteCode) ? 'Letters, digits, _ -' : undefined,
    password: pwError ?? undefined,
    confirm: f.confirm && f.confirm !== f.password ? 'Passwords do not match' : undefined,
  };
  const ready = f.orgName && f.orgSlug && f.siteName && f.siteCode && f.email && f.username && f.password && !Object.values(errors).some(Boolean) && f.confirm === f.password;
  const allOk = test.data && Object.entries(test.data).filter(([k]) => k !== 'ari').every(([, v]) => v.ok);

  if (status.isLoading) return <LoadingState className="h-screen" />;
  if (status.error) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-center gap-2"><AudioWaveform className="size-6 text-primary" /><h1 className="text-[18px] font-semibold">Installation wizard</h1></div>
      {status.data?.installed || complete.isSuccess ? (
        <InlineAlert tone="ok" title={complete.isSuccess ? 'Setup complete' : 'Already installed'}>
          {complete.isSuccess ? 'The administrator account was created.' : 'Setup has already been completed for this installation.'} <Link className="font-medium text-primary underline" href="/login">Sign in</Link>
        </InlineAlert>
      ) : (
        <div className="space-y-4">
          <Card title="1. Test connections" actions={<Button size="sm" icon={<PlugZap className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate()}>Run tests</Button>}>
            {test.error ? <InlineAlert tone="crit">{String((test.error as Error).message)}</InlineAlert> : !test.data ? (
              <p className="text-[13px] text-muted">Tests PostgreSQL, the Asterisk realtime schema, the connector, AMI, ARI and the recording directory using the server-side configuration in <code>/etc/echelons</code>.</p>
            ) : (
              <ul className="space-y-1.5">
                {Object.entries(test.data).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="font-medium capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate text-muted">{v.detail}</span><StatusBadge tone={v.ok ? 'ok' : k === 'ari' ? 'warn' : 'crit'}>{v.ok ? 'OK' : k === 'ari' ? 'Optional' : 'Failed'}</StatusBadge></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="2. Organization and site">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Organization name" required>{(id) => <Input id={id} value={f.orgName} onChange={set('orgName')} />}</Field>
              <Field label="Organization slug" required error={errors.orgSlug}>{(id) => <Input id={id} value={f.orgSlug} onChange={set('orgSlug')} placeholder="acme-hotels" />}</Field>
              <Field label="Site name" required>{(id) => <Input id={id} value={f.siteName} onChange={set('siteName')} />}</Field>
              <Field label="Site code" required error={errors.siteCode}>{(id) => <Input id={id} value={f.siteCode} onChange={set('siteCode')} />}</Field>
              <Field label="Timezone">{(id) => <Input id={id} value={f.timezone} onChange={set('timezone')} />}</Field>
              <Field label="Asterisk server name">{(id) => <Input id={id} value={f.serverName} onChange={set('serverName')} />}</Field>
            </div>
          </Card>
          <Card title="3. Administrator account">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Username" required>{(id) => <Input id={id} value={f.username} onChange={set('username')} autoComplete="username" />}</Field>
              <Field label="Email" required>{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
              <Field label="Display name">{(id) => <Input id={id} value={f.displayName} onChange={set('displayName')} />}</Field>
              <div />
              <Field label="Password" required error={errors.password} help="12+ characters, 3 of: lowercase, uppercase, digit, symbol">{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
              <Field label="Confirm password" required error={errors.confirm}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />}</Field>
            </div>
          </Card>
          {complete.error && <InlineAlert tone="crit" title="Setup failed">{(complete.error as Error).message}{errorDetails(complete.error).map((d) => <div key={d.message}>{d.path ?? ''} {d.message}</div>)}</InlineAlert>}
          <div className="flex items-center justify-end gap-3">
            {!allOk && <span className="text-[12.5px] text-muted">Run the connection tests first; all required checks must pass.</span>}
            <Button variant="primary" icon={<CheckCircle2 className="size-3.5" />} disabled={!ready || !allOk} loading={complete.isPending}
              onClick={() => complete.mutate({
                organization: { name: f.orgName, slug: f.orgSlug },
                site: { name: f.siteName, code: f.siteCode, timezone: f.timezone },
                server: { name: f.serverName },
                admin: { username: f.username, email: f.email, displayName: f.displayName, password: f.password },
              })}>
              Finish setup
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
