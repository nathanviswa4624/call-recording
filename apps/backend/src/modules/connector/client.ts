/**
 * Backend → Asterisk connector client. The backend never talks AMI/ARI directly
 * (docs/04 §1); everything goes through this authenticated internal API.
 */
import { AppError } from '../../lib/errors.js';
import { SecretBox } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import type { Readable } from 'node:stream';

export interface ConnectorHealth {
  ami: boolean;
  ari: boolean;
  version: { raw: string; major: number; minor: number; patch: number } | null;
  uptimeSec: number | null;
}

export interface AmiResponse {
  response: string;
  message?: string;
  events: Array<Record<string, string>>;
  fields: Record<string, string>;
}

export class ConnectorClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs = 20_000) {}

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new AppError('ASTERISK_UNAVAILABLE', `Asterisk connector unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg = data?.error?.message ?? `connector returned HTTP ${res.status}`;
      throw new AppError(res.status === 503 ? 'ASTERISK_UNAVAILABLE' : 'CONFIG_APPLY_FAILED', msg, data?.error?.details);
    }
    return data as T;
  }

  health() { return this.request<ConnectorHealth>('GET', '/v1/health', undefined, 5_000); }
  ami(action: string, params: Record<string, string> = {}) { return this.request<AmiResponse>('POST', '/v1/ami/action', { action, params }); }
  cli(command: string) { return this.request<{ output: string }>('POST', '/v1/cli', { command }); }
  reload(module: 'res_pjsip.so' | 'pbx_config.so' | 'res_pjsip_outbound_registration.so' | 'cdr' | 'res_pjsip_endpoint_identifier_ip.so') {
    return this.request<{ ok: boolean; output: string }>('POST', '/v1/reload', { module });
  }
  writeFile(name: string, content: string) { return this.request<{ sha256: string; backup: string | null }>('PUT', `/v1/files/${encodeURIComponent(name)}`, { content }); }
  restoreFile(name: string) { return this.request<{ ok: boolean }>('POST', `/v1/files/${encodeURIComponent(name)}/restore`, {}); }
  readFile(name: string) { return this.request<{ content: string | null }>('GET', `/v1/files/${encodeURIComponent(name)}`); }
  live() { return this.request<{ calls: Array<{ linkedid: string; caller: string; destination: string; pbxCode: string | null; pbxId: string | null; routeId: string | null; direction: string | null; startedAt: number; channels: number; recording: string; answered: boolean }> }>('GET', '/v1/live', undefined, 5_000); }
  /** Raw SSE event stream (live calls, recordings, endpoint status). */
  async events(signal: AbortSignal): Promise<Response> {
    const res = await fetch(new URL('/v1/events', this.baseUrl), { headers: { authorization: `Bearer ${this.token}` }, signal });
    if (!res.ok || !res.body) throw new AppError('ASTERISK_UNAVAILABLE', `connector event stream failed (${res.status})`);
    return res;
  }
  system() { return this.request<Record<string, unknown>>('GET', '/v1/system'); }
  netCheck(host: string, port: number, proto: 'udp' | 'tcp' | 'tls') {
    return this.request<Record<string, unknown>>('GET', `/v1/net/check?host=${encodeURIComponent(host)}&port=${port}&proto=${proto}`, undefined, 15_000);
  }
  recordingStat(path: string) { return this.request<{ exists: boolean; size: number; mtime: string | null }>('GET', `/v1/recordings/stat?path=${encodeURIComponent(path)}`); }
  deleteRecording(path: string) { return this.request<{ ok: boolean }>('DELETE', `/v1/recordings?path=${encodeURIComponent(path)}`); }
  testCall(endpoint: string, number: string, timeoutSec = 20) { return this.request<Record<string, unknown>>('POST', '/v1/test-call', { endpoint, number, timeoutSec }, (timeoutSec + 10) * 1000); }

  /** Range stream of a recording from the Asterisk host (used when storage is not mounted on the app host). */
  async streamRecording(path: string, range?: string): Promise<{ status: number; headers: Headers; body: Readable }> {
    const res = await fetch(new URL(`/v1/recordings/stream?path=${encodeURIComponent(path)}`, this.baseUrl), {
      headers: { authorization: `Bearer ${this.token}`, ...(range ? { range } : {}) },
    });
    if (!res.ok && res.status !== 206) throw new AppError(res.status === 404 ? 'NOT_FOUND' : 'ASTERISK_UNAVAILABLE', `recording stream failed (${res.status})`);
    const { Readable } = await import('node:stream');
    return { status: res.status, headers: res.headers, body: Readable.fromWeb(res.body as never) };
  }
}

const clients = new Map<string, ConnectorClient>();

export async function connectorFor(serverId: string): Promise<ConnectorClient> {
  const cached = clients.get(serverId);
  if (cached) return cached;
  const server = await prisma.asteriskServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError('NOT_FOUND', 'Asterisk server not found');
  const token = new SecretBox(env().ENCRYPTION_KEY).decrypt(server.connectorTokenEnc, `server:${server.id}`);
  const c = new ConnectorClient(server.connectorUrl, token);
  clients.set(serverId, c);
  return c;
}

export function invalidateConnector(serverId: string) {
  clients.delete(serverId);
}
