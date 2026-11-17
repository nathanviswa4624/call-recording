/**
 * Echelons Asterisk Connector (docs/04 §2). Runs on the Asterisk host.
 * Exposes a token-protected internal API; the web backend never talks to
 * AMI/ARI or the Asterisk filesystem directly.
 */
import Fastify from 'fastify';
import { createReadStream, promises as fs } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import pino from 'pino';
import { z } from 'zod';
import { checkCliCommand } from '@echelons/shared';
import { loadConfig } from './config.js';
import { AmiClient } from './ami/client.js';
import { ManagedFiles, confineRecording } from './files.js';
import { netCheck, parseVersion, systemStats } from './probes.js';
import { LiveCalls } from './live.js';

const cfg = loadConfig();
const log = pino({ level: cfg.LOG_LEVEL, base: { service: 'echelons-connector' }, redact: ['req.headers.authorization', 'Secret', '*.Secret'] });

const ami = new AmiClient({ host: cfg.ASTERISK_HOST, port: cfg.ASTERISK_AMI_PORT, username: cfg.ASTERISK_AMI_USERNAME, secret: cfg.ASTERISK_AMI_PASSWORD, log });
const files = new ManagedFiles(cfg.ASTERISK_CONFIG_DIR);
const live = new LiveCalls();
let version: ReturnType<typeof parseVersion> = null;

ami.on('connected', async () => {
  live.reset();
  try {
    version = parseVersion(await ami.command('core show version'));
    log.info({ version: version?.raw }, 'Asterisk version detected');
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'version probe failed');
  }
});
ami.on('event', (e) => live.handle(e));
ami.start();

/** One-at-a-time queue for mutating operations (reloads, file writes). */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const ALLOWED_AMI_ACTIONS = new Set([
  'PJSIPShowEndpoint', 'PJSIPShowEndpoints', 'PJSIPShowRegistrationsOutbound', 'PJSIPShowRegistrationsInbound', 'PJSIPShowContacts',
  'PJSIPShowAors', 'PJSIPShowAuths', 'PJSIPShowTransports', 'PJSIPShowIdentifies', 'PJSIPQualify', 'CoreShowChannels', 'BridgeList',
  'ModuleCheck', 'CoreStatus', 'CoreSettings', 'Ping', 'SorceryMemoryCacheExpireObject',
]);
const RELOAD_MODULES = new Set(['res_pjsip.so', 'pbx_config.so', 'res_pjsip_outbound_registration.so', 'cdr', 'res_pjsip_endpoint_identifier_ip.so']);

function tokenOk(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(cfg.CONNECTOR_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = Fastify({ logger: false, bodyLimit: 6 * 1024 * 1024 });

app.addHook('onRequest', async (req, reply) => {
  if (!tokenOk(req.headers.authorization)) {
    log.warn({ ip: req.ip, url: req.url }, 'rejected unauthenticated connector request');
    return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'invalid connector token' } });
  }
});

app.setErrorHandler((err: Error, req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? (/not connected/i.test(err.message) ? 503 : 422);
  log.warn({ url: req.url, err: err.message }, 'connector request failed');
  reply.code(status).send({ error: { code: status === 503 ? 'ASTERISK_UNAVAILABLE' : 'CONNECTOR_ERROR', message: err.message } });
});

const requireAmi = () => {
  if (!ami.connected) throw Object.assign(new Error('Asterisk AMI not connected'), { statusCode: 503 });
};

app.get('/v1/health', async () => {
  let uptimeSec: number | null = null;
  let ari = false;
  if (ami.connected) {
    const r = await ami.action('CoreStatus').catch(() => null);
    const started = r?.fields['CoreStartupDate'] && r.fields['CoreStartupTime'] ? Date.parse(`${r.fields['CoreStartupDate']}T${r.fields['CoreStartupTime']}`) : NaN;
    uptimeSec = Number.isNaN(started) ? null : Math.max(0, Math.round((Date.now() - started) / 1000));
  }
  if (cfg.ASTERISK_ARI_USERNAME) {
    const res = await fetch(`${cfg.ASTERISK_ARI_URL}/asterisk/info`, {
      headers: { authorization: `Basic ${Buffer.from(`${cfg.ASTERISK_ARI_USERNAME}:${cfg.ASTERISK_ARI_PASSWORD}`).toString('base64')}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    ari = Boolean(res?.ok);
  }
  return { ami: ami.connected, ari, version, uptimeSec };
});

app.post('/v1/ami/action', async (req) => {
  requireAmi();
  const b = z.object({ action: z.string(), params: z.record(z.string().max(256)).default({}) }).parse(req.body);
  if (!ALLOWED_AMI_ACTIONS.has(b.action)) throw Object.assign(new Error(`AMI action ${b.action} is not allowed`), { statusCode: 403 });
  return ami.action(b.action, b.params, 30_000);
});

app.post('/v1/cli', async (req) => {
  requireAmi();
  const b = z.object({ command: z.string().max(200) }).parse(req.body);
  // Defence in depth: the connector enforces the allowlist itself (active tier permitted —
  // the backend has already checked the user's cli.unsafe permission).
  const check = checkCliCommand(b.command, true);
  if (!check.allowed) throw Object.assign(new Error(check.reason), { statusCode: 403 });
  const run = () => ami.command(check.command, 30_000);
  const output = check.spec.tier === 'active' ? await serial(run) : await run();
  log.info({ command: check.command }, 'cli command executed');
  return { output };
});

app.post('/v1/reload', async (req) => {
  requireAmi();
  const { module } = z.object({ module: z.string() }).parse(req.body);
  if (!RELOAD_MODULES.has(module)) throw Object.assign(new Error('module not reloadable'), { statusCode: 403 });
  return serial(async () => {
    const r = await ami.action('Reload', { Module: module }, 60_000);
    return { ok: r.response === 'Success', output: r.message ?? '' };
  });
});

app.get('/v1/files/:name', async (req) => {
  const { name } = z.object({ name: z.string() }).parse(req.params);
  return { content: await files.read(name) };
});

app.put('/v1/files/:name', async (req) => {
  const { name } = z.object({ name: z.string() }).parse(req.params);
  const { content } = z.object({ content: z.string() }).parse(req.body);
  return serial(async () => {
    const r = await files.write(name, content);
    log.info({ file: name, sha256: r.sha256 }, 'managed file written');
    return r;
  });
});

app.post('/v1/files/:name/restore', async (req) => {
  const { name } = z.object({ name: z.string() }).parse(req.params);
  return serial(async () => ({ ok: await files.restore(name) }));
});

app.get('/v1/system', async () => systemStats(cfg.RECORDING_BASE_PATH));

app.get('/v1/net/check', async (req) => {
  const q = z.object({ host: z.string().max(253), port: z.coerce.number().int(), proto: z.enum(['udp', 'tcp', 'tls']) }).parse(req.query);
  return netCheck(q.host, q.port, q.proto);
});

app.get('/v1/recordings/stat', async (req) => {
  const { path: rel } = z.object({ path: z.string().max(512) }).parse(req.query);
  const full = await confineRecording(cfg.RECORDING_BASE_PATH, rel);
  try {
    const s = await fs.stat(full);
    return { exists: s.isFile(), size: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return { exists: false, size: 0, mtime: null };
  }
});

app.get('/v1/recordings/stream', async (req, reply) => {
  const { path: rel } = z.object({ path: z.string().max(512) }).parse(req.query);
  const full = await confineRecording(cfg.RECORDING_BASE_PATH, rel);
  const s = await fs.stat(full).catch(() => null);
  if (!s?.isFile()) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'recording not found' } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  reply.header('Accept-Ranges', 'bytes');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, s.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), s.size - 1) : s.size - 1;
    if (start > end) return reply.code(416).header('Content-Range', `bytes */${s.size}`).send();
    reply.code(206).header('Content-Range', `bytes ${start}-${end}/${s.size}`).header('Content-Length', end - start + 1);
    return reply.send(createReadStream(full, { start, end }));
  }
  reply.header('Content-Length', s.size);
  return reply.send(createReadStream(full));
});

app.delete('/v1/recordings', async (req) => {
  const { path: rel } = z.object({ path: z.string().max(512) }).parse(req.query);
  const full = await confineRecording(cfg.RECORDING_BASE_PATH, rel);
  await fs.unlink(full);
  log.info({ path: rel }, 'recording deleted');
  return { ok: true };
});

/** Synchronous AMI Originate into the ech-test context: SUCCESS when the far end answers. */
app.post('/v1/test-call', async (req) => {
  requireAmi();
  const b = z.object({ endpoint: z.string().regex(/^[A-Za-z0-9_.\-]{1,80}$/), number: z.string().regex(/^[0-9*#+]{1,32}$/), timeoutSec: z.number().int().min(5).max(60).default(20) }).parse(req.body);
  const r = await ami.action('Originate', {
    Channel: `PJSIP/${b.number}@${b.endpoint}`, Context: 'ech-test', Exten: 's', Priority: 1,
    Timeout: b.timeoutSec * 1000, CallerID: 'Echelons Test <0>', Async: 'false',
  }, (b.timeoutSec + 5) * 1000).catch((e: Error) => ({ response: 'Error', message: e.message, fields: {}, events: [] }));
  return { ok: r.response === 'Success', cause: r.message ?? null };
});

/** Server-Sent Events stream of live call/recording/endpoint events. */
app.get('/v1/events', (req, reply) => {
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', { calls: live.snapshot(), ami: ami.connected });
  const onCall = (event: string, data: unknown) => send(event, data);
  const onConn = () => send('asterisk.status', { connected: ami.connected, version });
  const hb = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  live.on('call', onCall);
  ami.on('connected', onConn);
  ami.on('disconnected', onConn);
  req.raw.on('close', () => {
    clearInterval(hb);
    live.off('call', onCall);
    ami.off('connected', onConn);
    ami.off('disconnected', onConn);
  });
});

app.get('/v1/live', async () => ({ calls: live.snapshot() }));

const shutdown = async () => {
  ami.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

app.listen({ host: cfg.CONNECTOR_HOST, port: cfg.CONNECTOR_PORT })
  .then(() => log.info({ host: cfg.CONNECTOR_HOST, port: cfg.CONNECTOR_PORT }, 'connector listening'))
  .catch((e) => { log.fatal({ err: (e as Error).message }, 'connector failed to start'); process.exit(1); });
