/**
 * Connector SSE → Socket.IO bridge. One subscription per Asterisk server;
 * events are re-emitted only to the owning organisation's room, so tenants
 * never see each other's live calls. Reconnects with back-off.
 */
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { connectorFor, invalidateConnector } from '../connector/client.js';
import { emitToOrg } from './hub.js';

export interface SseEvent { event: string; data: string }

/** Incremental text/event-stream parser. */
export class SseParser {
  private buf = '';
  push(chunk: string): SseEvent[] {
    this.buf += chunk.replace(/\r\n/g, '\n');
    const out: SseEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) !== -1) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    if (this.buf.length > 1_000_000) this.buf = '';
    return out;
  }
}

const FORWARDED = new Set(['snapshot', 'call.started', 'call.updated', 'call.ended', 'recording.started', 'recording.stopped', 'endpoint.status', 'registration.status', 'asterisk.status']);

export function startLiveBridge(log: FastifyBaseLogger): () => void {
  const controllers = new Map<string, AbortController>();
  let stopped = false;

  async function run(serverId: string, organizationId: string, serverName: string) {
    let delay = 2000;
    while (!stopped) {
      const ac = new AbortController();
      controllers.set(serverId, ac);
      try {
        const res = await (await connectorFor(serverId)).events(ac.signal);
        delay = 2000;
        log.info({ serverId }, 'live bridge connected');
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = res.body!.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
            if (!FORWARDED.has(ev.event)) continue;
            try {
              emitToOrg(organizationId, ev.event, { serverId, serverName, ...(JSON.parse(ev.data) as object) });
            } catch {
              /* ignore malformed event */
            }
          }
        }
      } catch (e) {
        if (stopped) return;
        log.warn({ serverId, err: (e as Error).message }, 'live bridge disconnected');
        invalidateConnector(serverId);
      }
      emitToOrg(organizationId, 'asterisk.status', { serverId, serverName, connected: false });
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }

  void (async () => {
    const servers = await prisma.asteriskServer.findMany({ select: { id: true, organizationId: true, name: true } });
    for (const s of servers) void run(s.id, s.organizationId, s.name);
  })().catch((e) => log.error({ err: (e as Error).message }, 'live bridge failed to start'));

  return () => {
    stopped = true;
    for (const c of controllers.values()) c.abort();
  };
}
