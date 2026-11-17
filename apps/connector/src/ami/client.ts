/**
 * Asterisk Manager Interface client.
 * - ActionID correlation, list-response collection (EventList start..Complete)
 * - keepalive Ping, exponential back-off reconnect (1s → 30s)
 * - never logs the Login action or secrets
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { AmiParser, serializeAction, type AmiMessage } from './protocol.js';

export interface AmiResult {
  response: string;
  message?: string;
  fields: AmiMessage;
  events: AmiMessage[];
}

interface Pending {
  resolve: (r: AmiResult) => void;
  reject: (e: Error) => void;
  result: AmiResult | null;
  isList: boolean;
  timer: NodeJS.Timeout;
}

export interface AmiOptions {
  host: string;
  port: number;
  username: string;
  secret: string;
  log: Logger;
  /** Event mask for the session. */
  events?: string;
}

export class AmiClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private parser = new AmiParser();
  private pending = new Map<string, Pending>();
  private reconnectDelay = 1000;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  connected = false;
  banner: string | null = null;

  constructor(private readonly opts: AmiOptions) {
    super();
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.destroy();
  }

  private connect() {
    const { host, port, log } = this.opts;
    this.parser = new AmiParser();
    const sock = net.createConnection({ host, port });
    this.socket = sock;
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 15_000);

    sock.on('connect', async () => {
      try {
        const r = await this.action('Login', { Username: this.opts.username, Secret: this.opts.secret, Events: this.opts.events ?? 'on' }, 10_000);
        if (r.response !== 'Success') throw new Error(r.message ?? 'login failed');
        this.connected = true;
        this.banner = this.parser.banner;
        this.reconnectDelay = 1000;
        log.info({ banner: this.banner }, 'AMI connected');
        this.emit('connected');
        this.pingTimer = setInterval(() => {
          this.action('Ping', {}, 10_000).catch(() => sock.destroy());
        }, 20_000);
      } catch (e) {
        log.error({ err: (e as Error).message }, 'AMI login failed');
        sock.destroy();
      }
    });

    sock.on('data', (chunk: string) => {
      let messages: AmiMessage[];
      try {
        messages = this.parser.push(chunk);
      } catch (e) {
        log.error({ err: (e as Error).message }, 'AMI parse error');
        sock.destroy();
        return;
      }
      for (const m of messages) this.dispatch(m);
    });

    sock.on('error', (e) => log.warn({ err: e.message }, 'AMI socket error'));
    sock.on('close', () => {
      const was = this.connected;
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('AMI connection closed'));
        this.pending.delete(id);
      }
      if (was) this.emit('disconnected');
      if (!this.stopped) {
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
        log.warn({ delayMs: delay }, 'AMI disconnected, reconnecting');
        setTimeout(() => this.connect(), delay);
      }
    });
  }

  private dispatch(m: AmiMessage) {
    const id = m['ActionID'];
    const p = id ? this.pending.get(id) : undefined;
    if (p) {
      if (m['Response'] !== undefined && !p.result) {
        p.result = { response: m['Response'], message: m['Message'], fields: m, events: [] };
        // A list response announces itself with EventList: start
        p.isList = (m['EventList'] ?? '').toLowerCase() === 'start';
        if (!p.isList || m['Response'] !== 'Success') return this.finish(id!, p);
        return;
      }
      if (m['Event'] !== undefined && p.result) {
        if ((m['EventList'] ?? '').toLowerCase() === 'complete') return this.finish(id!, p);
        p.result.events.push(m);
        return;
      }
    }
    if (m['Event']) this.emit('event', m);
  }

  private finish(id: string, p: Pending) {
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(p.result!);
  }

  /** Send an action and resolve with its (possibly list) response. */
  action(action: string, params: Record<string, string | number | undefined> = {}, timeoutMs = 15_000): Promise<AmiResult> {
    const sock = this.socket;
    if (!sock || sock.destroyed || (!this.connected && action !== 'Login')) {
      return Promise.reject(new Error('AMI not connected'));
    }
    const id = randomUUID();
    return new Promise<AmiResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AMI action ${action} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, result: null, isList: false, timer });
      try {
        sock.write(serializeAction(action, id, params));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Run a CLI command through the Command action and return its output text. */
  async command(cmd: string, timeoutMs = 20_000): Promise<string> {
    const r = await this.action('Command', { Command: cmd }, timeoutMs);
    // Asterisk 14+: Response: Success + Output lines. Older: Response: Follows.
    if (r.response === 'Error') throw new Error(r.message ?? 'command failed');
    return r.fields['Output'] ?? '';
  }
}
