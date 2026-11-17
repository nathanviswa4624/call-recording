'use client';
import { useState, type FormEvent } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui/primitives';
import { InlineAlert } from '@/components/ui/feedback';

export type LoginOutcome = 'ok' | 'mfa' | 'error';

/** Maps login errors to safe messages: never reveals whether the username exists. */
export function loginErrorMessage(e: unknown): { kind: 'mfa' | 'error'; message: string } {
  if (e instanceof ApiError) {
    const d = e.details as { mfaRequired?: boolean } | undefined;
    if (d?.mfaRequired) return { kind: 'mfa', message: 'This account requires multi-factor authentication.' };
    if (e.status === 429) return { kind: 'error', message: 'Too many sign-in attempts. Wait a minute and try again.' };
    if (e.status === 401) return { kind: 'error', message: /locked/i.test(e.message) ? e.message : 'Invalid username or password.' };
    if (e.status >= 500) return { kind: 'error', message: 'The server is unavailable. Try again shortly.' };
    return { kind: 'error', message: e.message };
  }
  return { kind: 'error', message: 'Could not reach the server. Check your connection.' };
}

export function LoginForm({ onLogin, onSuccess }: { onLogin: (u: string, p: string) => Promise<void>; onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await onLogin(username.trim(), password);
      onSuccess();
    } catch (err) {
      const r = loginErrorMessage(err);
      if (r.kind === 'mfa') setMfa(true);
      else setError(r.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  if (mfa) {
    return (
      <div className="space-y-3">
        <InlineAlert tone="warn" title="Multi-factor authentication required">
          Your account has MFA enabled, but TOTP verification is not available in this release of the platform.
          Ask an administrator to disable MFA for your account until it is.
        </InlineAlert>
        <Button className="w-full" onClick={() => setMfa(false)}>Back to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && <InlineAlert tone="crit">{error}</InlineAlert>}
      <Field label="Username or email" required>
        {(id) => <Input id={id} name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />}
      </Field>
      <Field label="Password" required>
        {(id) => <Input id={id} name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<Lock className="size-3.5" />}>Sign in</Button>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><ShieldAlert className="size-3" />Sign-in attempts are rate-limited and audited.</p>
    </form>
  );
}
