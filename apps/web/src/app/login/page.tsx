'use client';
import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AudioWaveform } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { setupApi } from '@/lib/api/audit';
import { LoginForm } from '@/components/domain/login-form';
import { InlineAlert } from '@/components/ui/feedback';

const PRODUCT = process.env.NEXT_PUBLIC_PRODUCT_NAME ?? 'Echelons Call Recording';

function safeNext(next: string | null): string {
  // Only same-origin relative paths (prevents open redirects).
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

function LoginInner() {
  const { status, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const setup = useQuery({ queryKey: ['setup', 'status'], queryFn: setupApi.status, retry: false });

  useEffect(() => { if (status === 'authenticated') router.replace(next); }, [status, router, next]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <AudioWaveform className="size-6 text-primary" aria-hidden />
          <div>
            <h1 className="text-[16px] font-semibold">{PRODUCT}</h1>
            <p className="text-[12px] text-muted">Call recording · SIP trunk · Asterisk management</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          {setup.data && !setup.data.installed ? (
            <InlineAlert tone="info" title="First-run setup required">
              This installation has no administrator yet. <Link className="font-medium text-primary underline" href="/setup">Run the setup wizard</Link>.
            </InlineAlert>
          ) : (
            <LoginForm onLogin={login} onSuccess={() => router.replace(next)} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
