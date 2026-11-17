'use client';
import { useQuery } from '@tanstack/react-query';
import { pbxApi } from '@/lib/api/pbx';
import { routeApi } from '@/lib/api/routes';
import { PageHeader } from '@/components/ui/data';
import { Card } from '@/components/ui/primitives';
import { ErrorState, LoadingState } from '@/components/ui/feedback';
import { RouteTester } from '@/components/domain/route-tester';

export default function RouteTesterPage() {
  const pbxs = useQuery({ queryKey: ['pbxs'], queryFn: pbxApi.list });
  return (
    <div className="space-y-4">
      <PageHeader title="Route Tester" description="Dry-run a dialled number against the configured routes. Uses the backend matcher — the same precedence the generated dialplan gives Asterisk." />
      <Card>
        {pbxs.isLoading ? <LoadingState /> : pbxs.error ? <ErrorState error={pbxs.error} onRetry={() => pbxs.refetch()} /> : (
          <RouteTester pbxs={pbxs.data ?? []} onTest={routeApi.test} />
        )}
      </Card>
      <p className="text-[12.5px] text-muted">Tests the saved draft routes. Changes reach Asterisk only after the configuration is applied.</p>
    </div>
  );
}
