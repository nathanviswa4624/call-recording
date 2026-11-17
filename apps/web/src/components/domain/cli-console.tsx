'use client';
/**
 * Controlled Asterisk CLI. Only commands matching the backend-provided allowlist
 * can be submitted (the same @echelons/shared allowlist the backend and the
 * connector enforce). There is no shell: input is an Asterisk CLI command only.
 */
import { useState, type FormEvent } from 'react';
import { Play, ShieldAlert } from 'lucide-react';
import { checkCliCommand } from '@echelons/shared';
import type { CliCommand } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/client';
import { Button, Input, cn } from '@/components/ui/primitives';
import { StatusBadge } from '@/components/ui/feedback';

export interface CliEntry { command: string; output: string; ok: boolean; ms: number; at: Date }

export function CliConsole({ commands, allowActive, run }: { commands: CliCommand[]; allowActive: boolean; run: (command: string) => Promise<string> }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CliEntry[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);

  async function exec(cmd: string) {
    const check = checkCliCommand(cmd, allowActive);
    if (!check.allowed) { setRejected(check.reason); return; }
    setRejected(null); setBusy(true);
    const started = performance.now();
    try {
      const output = await run(check.command);
      setHistory((h) => [{ command: check.command, output, ok: true, ms: Math.round(performance.now() - started), at: new Date() }, ...h].slice(0, 50));
    } catch (e) {
      setHistory((h) => [{ command: check.command, output: errorMessage(e), ok: false, ms: Math.round(performance.now() - started), at: new Date() }, ...h].slice(0, 50));
    } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (input.trim()) void exec(input); };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[18rem_1fr]">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Safe commands</p>
        <ul className="space-y-0.5">
          {commands.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setInput(c.example)} className="w-full rounded px-2 py-1 text-left hover:bg-surface-3" title={c.description}>
                <span className="block font-mono text-[12px] text-text">{c.example}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted">{c.tier === 'active' && <StatusBadge tone="warn" icon={false}>changes state</StatusBadge>}{c.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 space-y-3">
        <form onSubmit={submit} className="flex gap-2" aria-label="Asterisk CLI">
          <span className="flex items-center font-mono text-[13px] text-muted">CLI&gt;</span>
          <Input aria-label="Command" className="font-mono" value={input} onChange={(e) => { setInput(e.target.value); setRejected(null); }} placeholder="pjsip show endpoints" autoComplete="off" spellCheck={false} />
          <Button type="submit" variant="primary" icon={<Play className="size-3.5" />} loading={busy}>Run</Button>
        </form>
        {rejected && <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-crit"><ShieldAlert className="size-3.5" />Rejected: {rejected}. Only allowlisted Asterisk CLI commands can run; shell access is not available.</p>}
        {history.length === 0 ? <p className="text-[13px] text-muted">Output appears here. Every command is audited.</p> : history.map((h, i) => (
          <div key={`${h.at.getTime()}-${i}`} className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-[12px]">
              <code className="font-mono font-medium text-text">{h.command}</code>
              <div className="flex-1" />
              <span className="text-muted tabular">{h.ms} ms · {h.at.toLocaleTimeString()}</span>
              <StatusBadge tone={h.ok ? 'ok' : 'crit'}>{h.ok ? 'OK' : 'Error'}</StatusBadge>
            </div>
            <pre className={cn('max-h-96 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre', !h.ok && 'text-crit')}>{h.output || '(no output)'}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
