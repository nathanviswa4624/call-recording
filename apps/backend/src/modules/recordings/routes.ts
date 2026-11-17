import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasPermission, PERMISSIONS as P } from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, forbidden, notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { buildCallWhere, callFilterSchema, encodeCursor } from '../calls/search.js';
import { driverFor, parseRange } from '../storage/drivers.js';
import { signMediaToken, verifyMediaToken, type MediaPurpose } from '../../lib/media-token.js';
import { env } from '../../config/env.js';
import { loadClaims } from '../auth/service.js';
import type { FastifyReply } from 'fastify';

const idParam = z.object({ id: z.string().uuid() });

type RecordingFiles = { mixed?: string; caller?: string; callee?: string; mp3?: string };

/** Load a recording and enforce tenant + agent access (spec §31). */
async function loadAccessible(req: FastifyRequest, id: string) {
  const a = req.auth!;
  const rec = await prisma.recording.findFirst({ where: { id, organizationId: a.org }, include: { storageLocation: true, call: true } });
  if (!rec || rec.state === 'DELETED') throw notFound('Recording');
  if (a.sites.length && rec.siteId && !a.sites.includes(rec.siteId)) throw notFound('Recording');
  if (!hasPermission(a.perms, P.RECORDINGS_VIEW_ALL)) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.sub }, select: { extensions: true } });
    const call = rec.call;
    const own = call && (call.agentUserId === a.sub || [call.extension, call.callerNumber, call.destinationNumber].some((n) => n && user.extensions.includes(n)));
    const grant = own ? null : await prisma.recordingAccessGrant.findFirst({ where: { recordingId: id, userId: a.sub, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!own && !grant) throw notFound('Recording'); // do not reveal existence
  }
  return rec;
}

const SAFE_CONTENT: Record<string, string> = { wav: 'audio/wav', wav49: 'audio/wav', gsm: 'audio/x-gsm', mp3: 'audio/mpeg' };

const MEDIA_TOKEN_TTL_SEC = 300;
const channelEnum = z.enum(['mixed', 'caller', 'callee', 'mp3']);

export async function recordingRoutes(app: FastifyInstance) {
  /**
   * Media auth: either a normal Bearer token, or a signed media token (?t=) issued by
   * POST /recordings/:id/media-token. With a media token the user's CURRENT permissions
   * are reloaded and the recording access check runs again on every request.
   */
  const mediaAuth = (purpose: MediaPurpose, perm: typeof P.RECORDINGS_VIEW | typeof P.RECORDINGS_DOWNLOAD) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const t = (req.query as Record<string, unknown>)['t'];
      if (typeof t !== 'string') return app.requirePermission(perm)(req, reply);
      const payload = verifyMediaToken(t, env().JWT_SECRET);
      const { id } = parse(idParam, req.params);
      const channel = String((req.query as Record<string, unknown>)['channel'] ?? (purpose === 'stream' ? 'mixed' : 'original'));
      if (!payload || payload.rid !== id || payload.p !== purpose || payload.ch !== channel) throw new AppError('UNAUTHENTICATED', 'Invalid or expired media link');
      const user = await prisma.user.findUnique({ where: { id: payload.uid }, select: { status: true } });
      if (user?.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED', 'Account disabled');
      req.auth = await loadClaims(payload.uid);
      if (!hasPermission(req.auth.perms, perm)) throw forbidden();
    };

  /** Issue a short-lived URL usable by <audio> / download links (no session token in the URL). */
  app.post('/recordings/:id/media-token', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({
      purpose: z.enum(['stream', 'download']).default('stream'),
      channel: z.union([channelEnum, z.literal('original')]).default('mixed'),
    }), req.body ?? {});
    if (b.purpose === 'download' && !hasPermission(req.auth!.perms, P.RECORDINGS_DOWNLOAD)) throw forbidden('Download is not permitted for your role');
    const channel = b.purpose === 'download' ? (b.channel === 'mp3' ? 'mp3' : 'original') : (b.channel === 'original' ? 'mixed' : b.channel);
    await loadAccessible(req, id);
    const exp = Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL_SEC;
    const token = signMediaToken({ uid: req.auth!.sub, rid: id, ch: channel, p: b.purpose, exp }, env().JWT_SECRET);
    const path = b.purpose === 'stream'
      ? `/api/recordings/${id}/stream?channel=${channel}&t=${encodeURIComponent(token)}`
      : `/api/recordings/${id}/download?format=${channel === 'mp3' ? 'mp3' : 'original'}&channel=${channel}&t=${encodeURIComponent(token)}`;
    return { url: path, expiresAt: new Date(exp * 1000).toISOString() };
  });

  /** Recording search: same filters as calls, only calls that have a recording. */
  app.get('/recordings', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req) => {
    const f = parse(callFilterSchema, req.query);
    const where = buildCallWhere({ ...f, hasRecording: true }, req.auth!);
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT c.id AS call_id, c.start_time, c.caller_number, c.caller_name, c.destination_number, c.direction,
             c.answer_status, c.billsec, c.duration, ct.code AS call_type, ct.name AS call_type_name,
             rt.name AS route_name, rp.pattern AS route_pattern, p.name AS pbx_name, tr.name AS trunk_name, c.extension, c.department,
             r.id AS recording_id, r.format, r.layout, r.size_bytes, r.duration_sec, r.state
      FROM app.calls c
      JOIN LATERAL (SELECT * FROM app.recordings r WHERE r.call_id = c.id AND r.state <> 'DELETED' ORDER BY r.started_at LIMIT 1) r ON true
      LEFT JOIN app.call_types ct ON ct.id = c.call_type_id
      LEFT JOIN app.routes rt ON rt.id = c.route_id
      LEFT JOIN app.route_patterns rp ON rp.id = c.route_pattern_id
      LEFT JOIN app.pbxs p ON p.id = c.source_pbx_id
      LEFT JOIN app.sip_trunks tr ON tr.id = c.trunk_id
      WHERE ${where}
      ORDER BY c.start_time DESC, c.id DESC
      LIMIT ${f.limit + 1}`);
    const more = rows.length > f.limit;
    const items: Array<Record<string, unknown>> = rows.slice(0, f.limit).map((r) => ({ ...r, size_bytes: Number(r['size_bytes'] ?? 0) }));
    const last = items[items.length - 1];
    return { items, nextCursor: more && last ? encodeCursor(last['start_time'] as Date, String(last['call_id'])) : null };
  });

  app.get('/recordings/:id', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const rec = await loadAccessible(req, id);
    const [tags, notes] = await Promise.all([
      prisma.recordingTag.findMany({ where: { recordingId: id } }),
      prisma.recordingNote.findMany({ where: { recordingId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const files = rec.files as RecordingFiles;
    const { storageLocation, ...rest } = rec;
    return {
      ...rest,
      sizeBytes: Number(rec.sizeBytes),
      storage: { id: storageLocation.id, name: storageLocation.name, kind: storageLocation.kind },
      channels: { mixed: Boolean(files.mixed), caller: Boolean(files.caller), callee: Boolean(files.callee), mp3: Boolean(files.mp3) },
      files: undefined,
      tags: tags.map((t) => t.tag),
      notes,
    };
  });

  /** Authenticated audio stream with HTTP Range support. */
  app.get('/recordings/:id/stream', { preHandler: mediaAuth('stream', P.RECORDINGS_VIEW) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ channel: channelEnum.default('mixed'), t: z.string().optional() }), req.query);
    const rec = await loadAccessible(req, id);
    const files = rec.files as RecordingFiles;
    const rel = files[q.channel];
    if (!rel) throw notFound(`${q.channel} channel`);
    const driver = driverFor(rec.storageLocation);
    const st = await driver.stat(rel);
    if (!st.exists) throw new AppError('NOT_FOUND', 'Recording file is missing from storage');
    const range = parseRange(req.headers.range, st.size);
    const ext = rel.split('.').pop() ?? 'wav';
    reply.header('Content-Type', SAFE_CONTENT[ext] ?? 'application/octet-stream');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (range === 'unsatisfiable') {
      reply.code(416).header('Content-Range', `bytes */${st.size}`);
      return reply.send();
    }
    if (range) {
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`).header('Content-Length', range.end - range.start + 1);
      return reply.send(await driver.read(rel, range));
    }
    reply.header('Content-Length', st.size);
    return reply.send(await driver.read(rel));
  });

  app.get('/recordings/:id/download', { preHandler: mediaAuth('download', P.RECORDINGS_DOWNLOAD) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ format: z.enum(['original', 'mp3']).default('original'), channel: z.string().optional(), t: z.string().optional() }), req.query);
    const rec = await loadAccessible(req, id);
    const files = rec.files as RecordingFiles;
    const rel = q.format === 'mp3' ? files.mp3 : files.mixed;
    if (!rel) throw notFound(q.format === 'mp3' ? 'MP3 version' : 'Recording file');
    const driver = driverFor(rec.storageLocation);
    const filename = rel.split('/').pop()!.replace(/[^A-Za-z0-9._-]/g, '_');
    await audit(req, { action: 'recording.download', objectType: 'recording', objectId: id, objectLabel: filename, result: 'SUCCESS' });
    if (driver.presign) {
      const url = await driver.presign(rel, 300, filename);
      // Browser navigation (media token) gets a redirect; API clients get JSON.
      if (q.t) return reply.redirect(url, 302);
      return { url, expiresInSec: 300 };
    }
    const st = await driver.stat(rel);
    if (!st.exists) throw new AppError('NOT_FOUND', 'Recording file is missing from storage');
    reply.header('Content-Type', SAFE_CONTENT[rel.split('.').pop() ?? ''] ?? 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', st.size);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(await driver.read(rel));
  });

  app.delete('/recordings/:id', { preHandler: app.requirePermission(P.RECORDINGS_DELETE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const rec = await loadAccessible(req, id);
    if (rec.legalHold) throw new AppError('CONFLICT', 'Recording is under legal hold');
    const driver = driverFor(rec.storageLocation);
    const files = Object.values(rec.files as RecordingFiles).filter(Boolean) as string[];
    // Delete files first; metadata only after every file is gone (spec §34).
    for (const f of files) {
      const st = await driver.stat(f);
      if (st.exists) await driver.delete(f);
    }
    await withTenant(req.auth!.org, async (tx) => {
      await tx.recording.update({ where: { id }, data: { state: 'DELETED', files: {} } });
      if (rec.callId) {
        const remaining = await tx.recording.count({ where: { callId: rec.callId, state: { not: 'DELETED' } } });
        if (!remaining) await tx.call.update({ where: { id: rec.callId }, data: { hasRecording: false } });
      }
      await audit(req, { action: 'recording.delete', objectType: 'recording', objectId: id, objectLabel: rec.baseName, oldValue: { files }, result: 'SUCCESS' }, tx);
    });
    reply.code(204);
  });

  app.post('/recordings/:id/tags', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { tag } = parse(z.object({ tag: z.string().trim().min(1).max(48).regex(/^[\p{L}\p{N} _.-]+$/u) }), req.body);
    await loadAccessible(req, id);
    await prisma.recordingTag.upsert({ where: { recordingId_tag: { recordingId: id, tag } }, update: {}, create: { recordingId: id, tag, createdBy: req.auth!.sub } });
    return { ok: true };
  });

  app.delete('/recordings/:id/tags/:tag', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req) => {
    const { id, tag } = parse(z.object({ id: z.string().uuid(), tag: z.string().max(48) }), req.params);
    await loadAccessible(req, id);
    await prisma.recordingTag.deleteMany({ where: { recordingId: id, tag } });
    return { ok: true };
  });

  app.post('/recordings/:id/notes', { preHandler: app.requirePermission(P.RECORDINGS_VIEW) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(4000) }), req.body);
    await loadAccessible(req, id);
    reply.code(201);
    return prisma.recordingNote.create({ data: { recordingId: id, authorId: req.auth!.sub, body } });
  });

  /** Grant an agent access to a specific recording. */
  app.post('/recordings/:id/grants', { preHandler: app.requirePermission(P.RECORDINGS_VIEW_ALL) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ userId: z.string().uuid(), expiresAt: z.coerce.date().optional() }), req.body);
    await loadAccessible(req, id);
    const user = await prisma.user.findFirst({ where: { id: body.userId, organizationId: req.auth!.org } });
    if (!user) throw forbidden('User is not in your organization');
    const g = await prisma.recordingAccessGrant.upsert({
      where: { recordingId_userId: { recordingId: id, userId: body.userId } },
      update: { expiresAt: body.expiresAt ?? null, grantedBy: req.auth!.sub },
      create: { recordingId: id, userId: body.userId, expiresAt: body.expiresAt ?? null, grantedBy: req.auth!.sub },
    });
    await audit(req, { action: 'recording.grant', objectType: 'recording', objectId: id, newValue: body, result: 'SUCCESS' });
    return g;
  });
}
