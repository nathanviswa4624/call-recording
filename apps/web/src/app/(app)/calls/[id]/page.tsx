'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Tag, X } from 'lucide-react';
import { PERMISSIONS as P } from '@echelons/shared';
import { callApi } from '@/lib/api/calls';
import { recordingApi } from '@/lib/api/recordings';
import { ApiError, errorMessage } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { fmtBytes, fmtDateTime, fmtDuration } from '@/lib/format';
import { DataTable, PageHeader } from '@/components/ui/data';
import { Button, Card, DefinitionList, Input, Tabs } from '@/components/ui/primitives';
import { EmptyState, ErrorState, InlineAlert, LoadingState, StatusBadge } from '@/components/ui/feedback';
import { CallStatusCell, DirectionCell } from '@/components/domain/call-cells';
import { CallFlow } from '@/components/domain/call-flow';
import { AudioPlayer } from '@/components/domain/audio-player';

function RecordingPanel({ id }: { id: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const rec = useQuery({ queryKey: ['recording', id], queryFn: () => recordingApi.get(id) });
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const addTag = useMutation({ mutationFn: () => recordingApi.addTag(id, tag), onSuccess: () => { setTag(''); void qc.invalidateQueries({ queryKey: ['recording', id] }); } });
  const rmTag = useMutation({ mutationFn: (t: string) => recordingApi.removeTag(id, t), onSuccess: () => void qc.invalidateQueries({ queryKey: ['recording', id] }) });
  const addNote = useMutation({ mutationFn: () => recordingApi.addNote(id, note), onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: ['recording', id] }); } });
  if (rec.isLoading) return <LoadingState />;
  if (rec.error) return <ErrorState error={rec.error} onRetry={() => rec.refetch()} title={rec.error instanceof ApiError && rec.error.status === 404 ? 'Recording not accessible' : undefined} />;
  const r = rec.data!;
  const playable = r.state === 'AVAILABLE' || r.state === 'ARCHIVED';
  return (
    <div className="space-y-3">
      {playable ? <AudioPlayer recordingId={id} channels={r.channels} canDownload={can(P.RECORDINGS_DOWNLOAD)} waveform={(r as { waveform?: number[] | null }).waveform ?? null} />
        : <InlineAlert tone={r.state === 'MISSING_FILE' ? 'crit' : 'warn'} title={r.state === 'MISSING_FILE' ? 'Recording file missing' : 'Recording is still being processed'}>
          {r.state === 'MISSING_FILE' ? 'The CDR references a recording, but the file was not found in storage after the grace period.' : 'The file is verified by the worker shortly after the call ends.'}
        </InlineAlert>}
      <DefinitionList columns={3} items={[
        ['Recording file', <span key="f" className="font-mono text-[12px]">{r.baseName}.{r.format}</span>], ['Format', r.format.toUpperCase()], ['Layout', r.layout === 'MIXED' ? 'Mixed' : 'Mixed + caller/callee channels'],
        ['Size', fmtBytes(r.sizeBytes)], ['Recording duration', fmtDuration(r.durationSec)], ['Storage', `${r.storage.name} (${r.storage.kind})`],
        ['Started', fmtDateTime(r.startedAt)], ['Retention until', r.retentionExpiresAt ? fmtDateTime(r.retentionExpiresAt) : 'Unlimited'], ['Legal hold', r.legalHold ? 'Yes' : 'No'],
      ]} />
      <div className="flex flex-wrap items-center gap-1.5">
        {r.tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[12px]"><Tag className="size-3" />{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => rmTag.mutate(t)}><X className="size-3" /></button></span>)}
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (tag.trim()) addTag.mutate(); }}>
          <Input aria-label="New tag" className="h-7 w-32" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag" maxLength={48} />
          <Button size="sm" type="submit" disabled={!tag.trim()} loading={addTag.isPending}>Add</Button>
        </form>
      </div>
      {addTag.error && <InlineAlert tone="crit">{errorMessage(addTag.error)}</InlineAlert>}
      <div className="space-y-2">
        {r.notes.map((n) => <div key={n.id} className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px]"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-[11.5px] text-muted">{fmtDateTime(n.createdAt)}</p></div>)}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
          <Input aria-label="Add note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" maxLength={4000} />
          <Button type="submit" icon={<MessageSquarePlus className="size-3.5" />} disabled={!note.trim()} loading={addNote.isPending}>Add note</Button>
        </form>
      </div>
    </div>
  );
}

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['call', id], queryFn: () => callApi.get(id) });
  const [tab, setTab] = useState<'overview' | 'cdr' | 'events'>('overview');
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} title={q.error instanceof ApiError && q.error.status === 404 ? 'Call not found or not accessible' : undefined} />;
  const c = q.data!;
  const ech = (k: string) => c.cdrs.map((r) => r.extra?.[k]).find((v) => v !== undefined && v !== null && v !== '') as string | undefined;
  return (
    <div className="space-y-4">
      <PageHeader title={`${c.callerNumber ?? 'Unknown'} → ${c.destinationNumber ?? c.dialedNumber ?? 'Unknown'}`} breadcrumbs={[{ label: 'Call History', href: '/calls' }, { label: 'Call details' }]}
        description={<span className="flex items-center gap-2">{fmtDateTime(c.startTime)} · <DirectionCell direction={c.direction} /> · <CallStatusCell status={c.answerStatus} /> · {fmtDuration(c.billsec)}</span>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'cdr', label: `CDR (${c.cdrs.length})` }, { value: 'events', label: `Events / CEL (${c.events.length})` }]} />
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="space-y-4 xl:col-span-3">
            <Card title="Recording">{c.recordings.length ? c.recordings.map((r) => <RecordingPanel key={r.id} id={r.id} />) : <EmptyState title="No recording" description="The recording policy for this route did not record the call, or the call was not answered." />}</Card>
            <Card title="Call information">
              <DefinitionList columns={3} items={[
                ['Caller', `${c.callerNumber ?? '—'}${c.callerName ? ` (${c.callerName})` : ''}`], ['Called number', c.destinationNumber], ['Dialled', c.dialedNumber],
                ['Extension', c.extension], ['Department', c.department], ['Queue', c.queue],
                ['Start', fmtDateTime(c.startTime)], ['Answer', fmtDateTime(c.answerTime)], ['End', fmtDateTime(c.endTime)],
                ['Duration', fmtDuration(c.duration)], ['Billable', fmtDuration(c.billsec)], ['Hangup cause', c.hangupCause ?? '—'],
                ['Call type', c.callType?.name ?? 'Unclassified'], ['Tags', c.tags.join(', ') || '—'], ['Linked ID', <span key="l" className="font-mono text-[12px]">{c.linkedid}</span>],
              ]} />
            </Card>
            <Card title="Routing decision">
              <DefinitionList columns={3} items={[
                ['Source PBX', c.sourcePbx?.name], ['Source trunk', c.trunk?.name], ['Destination trunk', c.route?.egressTrunk?.name ?? '—'],
                ['Route', c.route ? `#${c.route.routeNumber} ${c.route.name}` : 'Unrouted'], ['Route pattern', c.routePattern ? `${c.routePattern.prefix ?? ''}${c.routePattern.pattern}` : '—'], ['Dialplan context', c.context],
                ['Recording policy', ech('ech_rec_policy') ?? '—'], ['Dial status', ech('ech_dialstatus') ?? '—'], ['Direction', c.direction],
              ]} />
            </Card>
            <Card title="SIP information">
              {c.sipCallId || c.sourceIp || c.userAgent ? (
                <DefinitionList columns={3} items={[
                  ['SIP Call-ID', <span key="s" className="font-mono text-[12px]">{c.sipCallId}</span>], ['Source IP', c.sourceIp], ['Destination IP', c.destinationIp],
                  ['User-Agent', c.userAgent], ['Transport', c.transport ?? c.trunk?.protocol?.toUpperCase()], ['SIP response', c.sipResponse ?? '—'],
                ]} />
              ) : <p className="text-[13px] text-muted">No SIP details were recorded for this call.</p>}
            </Card>
          </div>
          <Card title="Call flow" className="xl:col-span-2"><CallFlow call={c} /></Card>
        </div>
      )}
      {tab === 'cdr' && (
        <Card bodyClassName="p-0">
          <DataTable rows={c.cdrs} rowKey={(r) => r.id} dense empty={{ title: 'No CDR rows' }} columns={[
            { key: 'u', header: 'Unique ID', cell: (r) => <span className="font-mono text-[12px]">{r.uniqueid}</span> },
            { key: 'd', header: 'Call date', cell: (r) => fmtDateTime(r.calldate) },
            { key: 's', header: 'src → dst', cell: (r) => <span className="font-mono text-[12px]">{r.src} → {r.dst}</span> },
            { key: 'c', header: 'Channel', cell: (r) => <span className="font-mono text-[11.5px]">{r.channel}</span> },
            { key: 'dc', header: 'Dst channel', cell: (r) => <span className="font-mono text-[11.5px]">{r.dstchannel}</span> },
            { key: 'x', header: 'Context', cell: (r) => r.dcontext },
            { key: 'a', header: 'Last app', cell: (r) => <span className="font-mono text-[11.5px]">{r.lastapp}({(r.lastdata ?? '').slice(0, 40)})</span> },
            { key: 'b', header: 'Billsec', align: 'right', cell: (r) => r.billsec },
            { key: 'p', header: 'Disposition', cell: (r) => <StatusBadge tone={r.disposition === 'ANSWERED' ? 'ok' : 'warn'}>{r.disposition}</StatusBadge> },
          ]} />
        </Card>
      )}
      {tab === 'events' && (
        <Card bodyClassName="p-0">
          <DataTable rows={c.events} rowKey={(r) => r.id} dense empty={{ title: 'No events recorded', description: 'SIP timeline and CEL events are not imported yet in this release; CDR data is shown on the CDR tab.' }} columns={[
            { key: 't', header: 'Time', cell: (r) => fmtDateTime(r.at) }, { key: 'k', header: 'Kind', cell: (r) => r.kind }, { key: 'l', header: 'Event', cell: (r) => r.label },
            { key: 'd', header: 'Data', cell: (r) => <span className="font-mono text-[11.5px]">{JSON.stringify(r.data).slice(0, 120)}</span> },
          ]} />
        </Card>
      )}
    </div>
  );
}
