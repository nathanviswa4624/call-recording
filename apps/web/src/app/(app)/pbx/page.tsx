'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { pbxApi } from '@/lib/api/pbx';
import type { Pbx } from '@/lib/api/types';
import { PermissionGuard } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card } from '@/components/ui/primitives';
import { ConfirmDialog, StatusText, useToast } from '@/components/ui/feedback';

export default function PbxListPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['pbxs'], queryFn: pbxApi.list });
  const [del, setDel] = useState<Pbx | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => pbxApi.remove(id),
    onSuccess: () => { toast.success('PBX deleted'); setDel(null); void qc.invalidateQueries({ queryKey: ['pbxs'] }); },
    onError: (e) => { toast.error('Delete failed', e); setDel(null); },
  });
  const add = <PermissionGuard all={[P.TRUNKS_CONFIGURE]}><Link href="/pbx/new"><Button variant="primary" icon={<Plus className="size-3.5" />}>Add PBX</Button></Link></PermissionGuard>;
  return (
    <>
      <PageHeader title="PBX Systems" description="PBXs connected to Asterisk over SIP trunks." actions={add} />
      <Card bodyClassName="p-0">
        <DataTable<Pbx>
          rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.id}
          empty={{ icon: Building2, title: 'No PBX configured', description: 'Connect your first PBX (Avaya, Mitel, Cisco, Alcatel, …) with the guided setup.', action: add }}
          columns={[
            { key: 'name', header: 'Name', sort: (r) => r.name, cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[12px] text-muted">{r.code}</p></div> },
            { key: 'vendor', header: 'Vendor', sort: (r) => r.vendor, cell: (r) => r.vendor },
            { key: 'addr', header: 'Address', cell: (r) => <span className="font-mono text-[12.5px]">{r.host}:{r.port}/{r.protocol}</span> },
            { key: 'site', header: 'Site', cell: (r) => r.site?.name ?? '—' },
            { key: 'srv', header: 'Asterisk', cell: (r) => r.server?.name ?? '—' },
            { key: 'trunks', header: 'Trunks', align: 'right', cell: (r) => r._count?.trunks ?? 0 },
            { key: 'routes', header: 'Routes', align: 'right', cell: (r) => r._count?.routes ?? 0 },
            { key: 'ctx', header: 'Inbound context', cell: (r) => <span className="font-mono text-[12.5px]">{r.inboundContext}</span> },
            { key: 'status', header: 'Status', cell: (r) => r.enabled ? <StatusText status={r.status} /> : <StatusText status="DISABLED" /> },
            { key: 'check', header: 'Last check', cell: (r) => <span className="text-text-2">{fmtDateTime(r.lastCheckAt)}</span> },
            {
              key: 'act', header: '', align: 'right', cell: (r) => (
                <div className="flex justify-end gap-1">
                  <Link href={`/trunks?pbx=${r.id}`}><Button size="sm" variant="ghost">Trunks</Button></Link>
                  <PermissionGuard all={[P.TRUNKS_CONFIGURE]}>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setDel(r)} />
                  </PermissionGuard>
                </div>
              ),
            },
          ]}
        />
      </Card>
      <ConfirmDialog open={Boolean(del)} title="Delete PBX?" danger confirmLabel="Delete" loading={remove.isPending} onCancel={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} requireText={del?.code}>
        <p>Deletes <span className="font-medium text-text">{del?.name}</span> from the draft configuration. The backend refuses if trunks still exist. Apply the configuration afterwards to remove it from Asterisk.</p>
      </ConfirmDialog>
    </>
  );
}
