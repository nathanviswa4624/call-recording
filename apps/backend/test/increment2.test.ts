import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { signMediaToken, verifyMediaToken } from '../src/lib/media-token.js';
import { SseParser } from '../src/modules/realtime/bridge.js';

const SECRET = 'x'.repeat(48);

describe('media tokens', () => {
  const now = Date.now();
  const base = { uid: 'u1', rid: 'r1', ch: 'mixed', p: 'stream' as const, exp: Math.floor(now / 1000) + 300 };

  it('round-trips a valid token', () => {
    expect(verifyMediaToken(signMediaToken(base, SECRET), SECRET, now)).toEqual(base);
  });
  it('rejects expired, tampered or foreign-key tokens', () => {
    expect(verifyMediaToken(signMediaToken({ ...base, exp: Math.floor(now / 1000) - 1 }, SECRET), SECRET, now)).toBeNull();
    const t = signMediaToken(base, SECRET);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...base, rid: 'other' })).toString('base64url');
    expect(verifyMediaToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyMediaToken(`${body}.${sig}x`, SECRET, now)).toBeNull();
    expect(verifyMediaToken(t, 'y'.repeat(48), now)).toBeNull();
    expect(verifyMediaToken('garbage', SECRET, now)).toBeNull();
  });
});

describe('SSE parser', () => {
  it('parses events across chunk boundaries and skips comments', () => {
    const p = new SseParser();
    expect(p.push(': ping\n\nevent: call.started\ndata: {"a"')).toEqual([]);
    expect(p.push(':1}\n\nevent: call.ended\r\ndata: {}\r\n\r\n')).toEqual([
      { event: 'call.started', data: '{"a":1}' },
      { event: 'call.ended', data: '{}' },
    ]);
  });
});

describe('HTTP security (no database required)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/none?schema=app',
      JWT_SECRET: SECRET,
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CONNECTOR_TOKEN: 'c'.repeat(32),
      LOG_LEVEL: 'fatal',
    });
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
  });
  afterAll(async () => app?.close());

  it('rejects recording streams without credentials', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/recordings/7d3c0f3e-1b8e-4d2a-9c55-0f3f0d1e2a3b/stream' });
    expect(r.statusCode).toBe(401);
  });
  it('rejects forged media tokens before any lookup', async () => {
    const id = '7d3c0f3e-1b8e-4d2a-9c55-0f3f0d1e2a3b';
    const r = await app.inject({ method: 'GET', url: `/api/recordings/${id}/stream?t=abc.def` });
    expect(r.statusCode).toBe(401);
    // A valid signature for a DIFFERENT recording must also fail.
    const t = signMediaToken({ uid: 'u', rid: 'another', ch: 'mixed', p: 'stream', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    const r2 = await app.inject({ method: 'GET', url: `/api/recordings/${id}/stream?channel=mixed&t=${encodeURIComponent(t)}` });
    expect(r2.statusCode).toBe(401);
    // A stream token cannot be used for download.
    const t3 = signMediaToken({ uid: 'u', rid: id, ch: 'mixed', p: 'stream', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    const r3 = await app.inject({ method: 'GET', url: `/api/recordings/${id}/download?t=${encodeURIComponent(t3)}` });
    expect(r3.statusCode).toBe(401);
  });
  it('requires authentication for CLI, config apply and new UI endpoints', async () => {
    for (const [method, url] of [['POST', '/api/asterisk/cli'], ['POST', '/api/config/apply'], ['GET', '/api/sites'], ['GET', '/api/calls/live'], ['PUT', '/api/auth/password'], ['GET', '/api/dialplans?serverId=x'], ['GET', '/api/system/health']] as const) {
      const r = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(r.statusCode, url).toBe(401);
      expect(r.json().error.code).toBe('UNAUTHENTICATED');
    }
  });
  it('sets security headers and request ids', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});
