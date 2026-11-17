'use client';
/** Visual call flow (spec §50): PBX → trunk → Asterisk → route matcher → classification → recording → destination. */
import { ArrowDown, AudioLines, Building2, Cable, Cpu, PhoneForwarded, Route, Tags } from 'lucide-react';
import type { CallDetail } from '@/lib/api/types';
import { cn } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/ui/feedback';

interface Step { icon: typeof Cpu; title: string; detail: string; edge?: string; muted?: boolean; badge?: { tone: 'ok' | 'warn' | 'crit' | 'neutral'; label: string } }

export function buildFlowSteps(c: CallDetail): Step[] {
  const pattern = c.routePattern ? `${c.routePattern.prefix ?? ''}${c.routePattern.pattern}` : null;
  const rec = c.recordings[0];
  return [
    { icon: Building2, title: c.sourcePbx ? `PBX ${c.sourcePbx.name}` : 'Source', detail: c.sourcePbx ? `${c.sourcePbx.vendor} · ${c.sourcePbx.host}` : c.sourceIp ?? 'Unknown origin', edge: 'SIP INVITE' },
    { icon: Cable, title: c.trunk ? `Trunk ${c.trunk.name}` : 'Trunk', detail: c.trunk ? `${c.trunk.host} · ${c.trunk.protocol.toUpperCase()}` : 'Not identified', muted: !c.trunk },
    { icon: Cpu, title: 'Asterisk', detail: [c.context && `context ${c.context}`, c.sipCallId && `Call-ID ${c.sipCallId.slice(0, 24)}…`].filter(Boolean).join(' · ') || 'Dialplan' },
    {
      icon: Route, title: 'Route matcher', detail: c.route ? `Route #${c.route.routeNumber} ${c.route.name}${pattern ? ` · pattern ${pattern}` : ''}` : 'No route matched (unrouted)',
      badge: c.route ? { tone: 'ok', label: 'Matched' } : { tone: 'warn', label: 'Unrouted' },
    },
    { icon: Tags, title: 'Call classification', detail: `${c.callType?.name ?? 'Unclassified'} · ${c.direction.toLowerCase()}${c.classifiedBy.length ? ` · ${c.classifiedBy.length} rule(s)` : ''}` },
    {
      icon: AudioLines, title: 'Recording policy', detail: rec ? `${rec.format.toUpperCase()} · ${rec.layout === 'MIXED' ? 'mixed' : 'mixed + split channels'}` : 'Not recorded',
      badge: rec ? (rec.state === 'AVAILABLE' || rec.state === 'ARCHIVED' ? { tone: 'ok', label: 'Recording available' } : { tone: rec.state === 'MISSING_FILE' ? 'crit' : 'warn', label: rec.state.replace('_', ' ').toLowerCase() }) : { tone: 'neutral', label: 'None' },
    },
    {
      icon: PhoneForwarded, title: 'Destination', detail: [c.destinationNumber ?? c.dialedNumber, c.route?.egressTrunk && `via ${c.route.egressTrunk.name}`].filter(Boolean).join(' ') || '—',
      badge: { tone: c.answerStatus === 'ANSWERED' ? 'ok' : c.answerStatus === 'FAILED' || c.answerStatus === 'CONGESTION' ? 'crit' : 'warn', label: c.answerStatus.replace('_', ' ').toLowerCase() },
    },
  ];
}

export function CallFlow({ call }: { call: CallDetail }) {
  const steps = buildFlowSteps(call);
  return (
    <ol className="flex flex-col items-stretch" aria-label="Call flow">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.title} className="flex flex-col items-center">
            {i > 0 && (
              <div className="flex flex-col items-center py-0.5 text-muted" aria-hidden>
                <span className="h-3 w-px bg-border-strong" />
                {steps[i - 1]!.edge && <span className="text-[10.5px] font-medium tracking-wide uppercase">{steps[i - 1]!.edge}</span>}
                <ArrowDown className="size-3.5" />
              </div>
            )}
            <div className={cn('flex w-full max-w-xl items-center gap-3 rounded-md border px-3 py-2', s.muted ? 'border-dashed border-border bg-surface' : 'border-border bg-surface-2')}>
              <Icon className="size-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text">{s.title}</p>
                <p className="truncate font-mono text-[11.5px] text-text-2">{s.detail}</p>
              </div>
              {s.badge && <StatusBadge tone={s.badge.tone}>{s.badge.label}</StatusBadge>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
