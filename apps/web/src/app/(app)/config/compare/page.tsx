'use client';
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { configApi } from '@/lib/api/config';
import { useServer } from '@/lib/server-context';
import { PageHeader } from '@/components/ui/data';
import { Card, Field, Select } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { ConfigDiff } from '@/components/domain/config-diff';

function CompareInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { serverId } = useServer();
  const versions = useQuery({ queryKey: ['config', 'versions', serverId], queryFn: () => configApi.versions(serverId!), enabled: Boolean(serverId) });
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const diff = useQuery({ queryKey: ['config', 'diff', a, b], queryFn: () => configApi.diff(a, b), enabled: Boolean(a && b && a !== b) });
  const setParam = (k: 'a' | 'b', v: string) => { const p = new URLSearchParams(params); p.set(k, v); router.replace(`${pathname}?${p}`); };
  return (
    <div className="space-y-4">
      <PageHeader title="Compare Versions" breadcrumbs={[{ label: 'Configuration Versions', href: '/config/versions' }, { label: 'Compare' }]} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {(['a', 'b'] as const).map((k) => (
            <Field key={k} label={k === 'a' ? 'From version' : 'To version'} className="w-72">{(id) => (
              <Select id={id} value={k === 'a' ? a : b} onChange={(e) => setParam(k, e.target.value)}>
                <option value="">Select…</option>
                {versions.data?.map((v) => <option key={v.id} value={v.id}>v{v.version} · {v.status.toLowerCase()} · {v.summary ?? new Date(v.createdAt).toLocaleString()}</option>)}
              </Select>
            )}</Field>
          ))}
        </div>
      </Card>
      <Card>
        {!a || !b ? <EmptyState title="Select two versions to compare" /> : a === b ? <EmptyState title="Select two different versions" /> : diff.isLoading ? <LoadingState /> : diff.error ? <ErrorState error={diff.error} onRetry={() => diff.refetch()} /> : diff.data && <ConfigDiff diff={diff.data} />}
      </Card>
    </div>
  );
}

export default function ComparePage() {
  return <Suspense><CompareInner /></Suspense>;
}
