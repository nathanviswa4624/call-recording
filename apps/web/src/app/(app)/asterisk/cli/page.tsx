'use client';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS as P } from '@echelons/shared';
import { asteriskApi } from '@/lib/api/asterisk';
import { PermissionGuard, useAuth } from '@/lib/auth';
import { useServer } from '@/lib/server-context';
import { PageHeader } from '@/components/ui/data';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { CliConsole } from '@/components/domain/cli-console';

export default function CliPage() {
  const { can } = useAuth();
  const { serverId, server } = useServer();
  const cmds = useQuery({ queryKey: ['cli', 'commands'], queryFn: asteriskApi.commands, enabled: can(P.CLI_ACCESS) });
  return (
    <PermissionGuard all={[P.CLI_ACCESS]} fallback={<EmptyState title="Not permitted" description="The Asterisk CLI requires the cli.access permission." />}>
      <PageHeader title="Asterisk CLI" description={<>Allowlisted Asterisk CLI commands on <span className="font-medium text-text">{server?.name ?? '—'}</span>. No shell access.</>} />
      <Card>
        {!serverId ? <EmptyState title="No Asterisk server registered" /> : cmds.isLoading ? <LoadingState /> : cmds.error ? <ErrorState error={cmds.error} onRetry={() => cmds.refetch()} /> : (
          <CliConsole commands={cmds.data ?? []} allowActive={can(P.CLI_UNSAFE)} run={async (c) => (await asteriskApi.cli(serverId, c)).output} />
        )}
      </Card>
    </PermissionGuard>
  );
}
