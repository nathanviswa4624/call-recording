'use client';
import type { TrunkTestResults } from '@/lib/api/types';
import { StatusBadge } from '@/components/ui/feedback';

/** Ordered display of the backend trunk connectivity test (spec §48). */
export function TestResults({ results }: { results: TrunkTestResults }) {
  const order = ['DNS', 'UDP', 'TCP', 'TLS', 'SIP OPTIONS', 'PJSIP endpoint', 'Test call'];
  const entries = Object.entries(results).sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-border last:border-0">
            <th scope="row" className="w-40 py-1.5 pr-3 text-left font-medium">{k}</th>
            <td className="py-1.5 pr-3"><StatusBadge tone={v.status === 'OK' ? 'ok' : v.status === 'SKIPPED' ? 'neutral' : 'crit'}>{v.status === 'OK' ? 'OK' : v.status === 'SKIPPED' ? 'Skipped' : 'Failed'}</StatusBadge></td>
            <td className="py-1.5 text-text-2">{v.detail ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
