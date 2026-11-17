'use client';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleDot, Mic, MicOff } from 'lucide-react';
import type { AnswerStatus, CallDirection } from '@/lib/api/types';
import { StatusBadge, type Tone } from '@/components/ui/feedback';

const DIR: Record<string, { label: string; icon: typeof ArrowDownLeft }> = {
  INBOUND: { label: 'Inbound', icon: ArrowDownLeft },
  OUTBOUND: { label: 'Outbound', icon: ArrowUpRight },
  INTERNAL: { label: 'Internal', icon: ArrowLeftRight },
  TRANSIT: { label: 'Transit', icon: ArrowLeftRight },
  UNKNOWN: { label: 'Unknown', icon: CircleDot },
};

export function DirectionCell({ direction }: { direction: CallDirection | string | null }) {
  const d = DIR[direction ?? 'UNKNOWN'] ?? DIR['UNKNOWN']!;
  const Icon = d.icon;
  return <span className="inline-flex items-center gap-1 text-text-2"><Icon className="size-3.5" aria-hidden />{d.label}</span>;
}

const STATUS: Record<AnswerStatus, [Tone, string]> = {
  ANSWERED: ['ok', 'Answered'], NO_ANSWER: ['warn', 'No answer'], BUSY: ['warn', 'Busy'], FAILED: ['crit', 'Failed'],
  CONGESTION: ['crit', 'Congestion'], ABANDONED: ['warn', 'Abandoned'],
};
export function CallStatusCell({ status }: { status: AnswerStatus }) {
  const [tone, label] = STATUS[status] ?? ['neutral', status];
  return <StatusBadge tone={tone as Tone}>{label}</StatusBadge>;
}

export function CallTypeCell({ name, color }: { name: string | null; color?: string | null }) {
  if (!name) return <span className="text-muted">Unclassified</span>;
  return <span className="inline-flex items-center gap-1.5">{color && <span className="inline-block size-2 rounded-full" style={{ background: color }} aria-hidden />}{name}</span>;
}

export function RecordingCell({ has, state }: { has: boolean; state?: string | null }) {
  if (!has) return <span className="inline-flex items-center gap-1 text-muted"><MicOff className="size-3.5" aria-hidden />None</span>;
  if (state && state !== 'AVAILABLE' && state !== 'ARCHIVED') return <StatusBadge tone={state === 'MISSING_FILE' ? 'crit' : 'warn'}>{state === 'MISSING_FILE' ? 'Missing file' : state === 'CLOSED' ? 'Processing' : state.toLowerCase()}</StatusBadge>;
  return <span className="inline-flex items-center gap-1 text-ok"><Mic className="size-3.5" aria-hidden />Available</span>;
}

export function Num({ children }: { children: string | null | undefined }) {
  return children ? <span className="font-mono text-[12.5px]">{children}</span> : <span className="text-muted">—</span>;
}
