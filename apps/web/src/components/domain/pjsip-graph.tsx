'use client';
import { ArrowRight } from 'lucide-react';
import type { ParamValue } from '@/lib/api/types';

interface Obj { type: string; name: string; params: Record<string, ParamValue | undefined> }

const ORDER = ['endpoint', 'aor', 'auth', 'identify', 'registration'];

/** Endpoint → AOR → Auth → Identify (→ Registration) relationship view. */
export function PjsipGraph({ objects }: { objects: Obj[] }) {
  const sorted = [...objects].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-2">
        {sorted.map((o, i) => (
          <div key={`${o.type}:${o.name}`} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />}
            <div className="min-w-40 rounded-md border border-border bg-surface-2 px-3 py-2">
              <p className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{o.type}</p>
              <p className="font-mono text-[12.5px] text-text">{o.name}</p>
              <p className="text-[11.5px] text-text-2">{relation(o)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {sorted.map((o) => (
          <pre key={`${o.type}:${o.name}:ini`} className="overflow-x-auto rounded-md border border-border bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed">
            {[`[${o.name}]`, `type=${o.type}`, ...Object.entries(o.params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${k === 'password' ? '********' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`)].join('\n')}
          </pre>
        ))}
      </div>
    </div>
  );
}

function relation(o: Obj): string {
  const p = o.params;
  switch (o.type) {
    case 'endpoint': return [p['aors'] && `aors=${p['aors']}`, p['outbound_auth'] && `auth=${p['outbound_auth']}`, p['transport'] && `via ${p['transport']}`].filter(Boolean).join(' · ');
    case 'aor': return p['contact'] ? String(p['contact']) : `max_contacts=${p['max_contacts'] ?? 1}`;
    case 'auth': return `user ${p['username'] ?? ''}`;
    case 'identify': return `match ${p['match'] ?? ''}`;
    case 'registration': return String(p['server_uri'] ?? '');
    default: return '';
  }
}
