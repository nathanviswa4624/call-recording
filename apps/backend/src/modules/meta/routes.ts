/**
 * Small endpoints required by the web UI (Increment 2):
 * sites, recording policies, system health, password change, live calls,
 * dialplan context CRUD.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verify } from '@node-rs/argon2';
import { ALLOWED_APPLICATIONS, PERMISSIONS as P, RESERVED_CONTEXT_PREFIX, compileDialplan, hasAnyPermission, isValidPattern } from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, forbidden, notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { connectorFor } from '../connector/client.js';
import { hashPassword, validatePasswordPolicy } from '../auth/service.js';
import { invalidateUserState } from '../../plugins/auth.js';

const CTX = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/);

export async function metaRoutes(app: FastifyInstance) {
  // ---------------- sites ----------------
  app.get('/sites', { preHandler: app.authenticate }, async (req) => {
    const a = req.auth!;
    return prisma.site.findMany({
      where: { organizationId: a.org, ...(a.sites.length ? { id: { in: a.sites } } : {}) },
      select: { id: true, name: true, code: true, timezone: true },
      orderBy: { name: 'asc' },
    });
  });

  // ---------------- recording policies ----------------
  app.get('/recording-policies', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) =>
    prisma.recordingPolicy.findMany({ where: { organizationId: req.auth!.org }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }));

  app.post('/recording-policies', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const b = parse(z.object({
      name: z.string().min(1).max(80),
      mode: z.enum(['NEVER', 'ALWAYS', 'INBOUND_ONLY', 'OUTBOUND_ONLY', 'ON_DEMAND']),
      layout: z.enum(['MIXED', 'MIXED_AND_SPLIT']).default('MIXED'),
      format: z.enum(['wav', 'wav49', 'gsm']).default('wav'),
    }), req.body);
    const p = await prisma.recordingPolicy.create({ data: { ...b, organizationId: req.auth!.org } });
    await audit(req, { action: 'recording_policy.create', objectType: 'recording_policy', objectId: p.id, objectLabel: p.name, newValue: b, result: 'SUCCESS' });
    reply.code(201);
    return p;
  });

  // ---------------- system health (dashboard) ----------------
  app.get('/system/health', { preHandler: app.authenticate }, async (req) => {
    let database: { status: 'HEALTHY' | 'CRITICAL'; detail?: string };
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = { status: 'HEALTHY' };
    } catch (e) {
      database = { status: 'CRITICAL', detail: 'database unreachable' };
      req.log.error({ err: (e as Error).message }, 'health: database');
    }
    const servers = await prisma.asteriskServer.findMany({ where: { organizationId: req.auth!.org }, select: { id: true, name: true, restartRequired: true } });
    const asterisk = await Promise.all(servers.map(async (s) => {
      try {
        const h = await (await connectorFor(s.id)).health();
        return { id: s.id, name: s.name, connector: 'HEALTHY', ami: h.ami ? 'HEALTHY' : 'CRITICAL', ari: h.ari ? 'HEALTHY' : 'WARNING', version: h.version?.raw ?? null, uptimeSec: h.uptimeSec, restartRequired: s.restartRequired };
      } catch {
        return { id: s.id, name: s.name, connector: 'CRITICAL', ami: 'UNKNOWN', ari: 'UNKNOWN', version: null, uptimeSec: null, restartRequired: s.restartRequired };
      }
    }));
    return { database, asterisk };
  });

  // ---------------- password change ----------------
  app.put('/auth/password', { preHandler: app.authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().max(256) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!(await verify(user.passwordHash, b.currentPassword).catch(() => false))) {
      await audit(req, { action: 'auth.password_change', objectType: 'user', objectId: user.id, result: 'FAILURE', error: 'wrong current password' });
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect');
    }
    const policy = validatePasswordPolicy(b.newPassword);
    if (policy) throw new AppError('VALIDATION_FAILED', policy);
    if (b.newPassword === b.currentPassword) throw new AppError('VALIDATION_FAILED', 'New password must differ from the current password');
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(b.newPassword) } }),
      // Sign out every other session.
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    invalidateUserState(user.id);
    await audit(req, { action: 'auth.password_change', objectType: 'user', objectId: user.id, result: 'SUCCESS' });
    return { ok: true };
  });

  // ---------------- live calls ----------------
  app.get('/calls/live', { preHandler: app.requirePermission(P.CALLS_VIEW) }, async (req) => {
    const servers = await prisma.asteriskServer.findMany({ where: { organizationId: req.auth!.org }, select: { id: true, name: true } });
    const pbxs = new Map((await prisma.pbx.findMany({ where: { organizationId: req.auth!.org }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const routes = new Map((await prisma.route.findMany({ where: { organizationId: req.auth!.org }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
    const out: unknown[] = [];
    const errors: Array<{ server: string; error: string }> = [];
    for (const s of servers) {
      try {
        const live = await (await connectorFor(s.id)).live();
        for (const c of live.calls) {
          out.push({ ...c, serverId: s.id, serverName: s.name, pbxName: c.pbxId ? pbxs.get(c.pbxId) ?? null : null, routeName: c.routeId ? routes.get(c.routeId) ?? null : null });
        }
      } catch (e) {
        errors.push({ server: s.name, error: (e as Error).message });
      }
    }
    return { calls: out, errors };
  });

  // ---------------- dialplan contexts (web editor) ----------------
  const priority = z.object({
    app: z.enum(ALLOWED_APPLICATIONS as unknown as [string, ...string[]]),
    args: z.string().max(1024).refine((s) => !/[\r\n\0]/.test(s), 'line breaks are not allowed').default(''),
    label: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/).nullish(),
  });
  const contextBody = z.object({
    serverId: z.string().uuid(),
    name: CTX.refine((n) => !n.startsWith(RESERVED_CONTEXT_PREFIX), `"${RESERVED_CONTEXT_PREFIX}" prefix is reserved`),
    description: z.string().max(255).nullish(),
    includes: z.array(CTX).max(50).default([]),
    extensions: z.array(z.object({
      exten: z.string().max(80).refine((e) => (e.startsWith('_') ? isValidPattern(e) : /^[0-9A-Za-z*#+]{1,80}$/.test(e)), 'invalid extension or pattern'),
      priorities: z.array(priority).min(1).max(100),
    })).max(500).default([]),
  });

  const dialplanView = { preHandler: async (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) => {
    await app.authenticate(req, reply);
    if (!hasAnyPermission(req.auth!.perms, [P.DIALPLAN_CONFIGURE, P.ROUTES_VIEW])) throw forbidden();
  } };

  app.get('/dialplans', dialplanView, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
    return prisma.dialplanContext.findMany({
      where: { serverId, organizationId: req.auth!.org },
      include: { extensions: { include: { priorities: { orderBy: { position: 'asc' } } }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  });

  async function saveContext(org: string, contextId: string | null, b: z.infer<typeof contextBody>, tx: Prisma.TransactionClient) {
    const ctx = contextId
      ? await tx.dialplanContext.update({ where: { id: contextId }, data: { name: b.name, description: b.description ?? null, includes: b.includes } })
      : await tx.dialplanContext.create({ data: { organizationId: org, serverId: b.serverId, name: b.name, description: b.description ?? null, includes: b.includes } });
    await tx.dialplanExtension.deleteMany({ where: { contextId: ctx.id } });
    for (const [i, e] of b.extensions.entries()) {
      await tx.dialplanExtension.create({
        data: { contextId: ctx.id, exten: e.exten, sortOrder: i, priorities: { create: e.priorities.map((p, pos) => ({ position: pos, app: p.app, args: p.args, label: p.label ?? null })) } },
      });
    }
    return ctx;
  }

  /** Compile-check the context in isolation so errors surface at save time, not apply time. */
  function compileCheck(b: z.infer<typeof contextBody>) {
    const r = compileDialplan({ version: 0, serverId: b.serverId, recordingBasePath: '/tmp', pbxs: [], trunks: [], routes: [], contexts: [{ name: b.name, includes: b.includes, extensions: b.extensions.map((e) => ({ exten: e.exten, priorities: e.priorities.map((p) => ({ app: p.app, args: p.args, label: p.label ?? undefined })) })) }] });
    const errors = r.issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new AppError('VALIDATION_FAILED', 'Dialplan context is invalid', errors);
  }

  app.post('/dialplans', { preHandler: app.requirePermission(P.DIALPLAN_CONFIGURE) }, async (req, reply) => {
    const b = parse(contextBody, req.body);
    const org = req.auth!.org;
    if (!(await prisma.asteriskServer.findFirst({ where: { id: b.serverId, organizationId: org } }))) throw notFound('Asterisk server');
    compileCheck(b);
    const ctx = await withTenant(org, async (tx) => {
      const c = await saveContext(org, null, b, tx);
      await audit(req, { action: 'dialplan.create', objectType: 'dialplan_context', objectId: c.id, objectLabel: c.name, newValue: b, result: 'SUCCESS' }, tx);
      return c;
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', `Context "${b.name}" already exists`);
      throw e;
    });
    reply.code(201);
    return ctx;
  });

  app.put('/dialplans/:id', { preHandler: app.requirePermission(P.DIALPLAN_CONFIGURE) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(contextBody, req.body);
    const org = req.auth!.org;
    const existing = await prisma.dialplanContext.findFirst({ where: { id, organizationId: org } });
    if (!existing) throw notFound('Dialplan context');
    if (existing.readOnly) throw new AppError('CONFLICT', 'Imported contexts are read-only');
    compileCheck({ ...b, serverId: existing.serverId });
    return withTenant(org, async (tx) => {
      const c = await saveContext(org, id, { ...b, serverId: existing.serverId }, tx);
      await audit(req, { action: 'dialplan.update', objectType: 'dialplan_context', objectId: id, objectLabel: c.name, oldValue: { name: existing.name }, newValue: b, result: 'SUCCESS' }, tx);
      return c;
    });
  });

  app.delete('/dialplans/:id', { preHandler: app.requirePermission(P.DIALPLAN_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const existing = await prisma.dialplanContext.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('Dialplan context');
    const usedBy = await prisma.route.count({ where: { organizationId: req.auth!.org, egressKind: 'CONTEXT', egressContext: existing.name } });
    if (usedBy) throw new AppError('CONFLICT', `Context is the destination of ${usedBy} route(s)`);
    await prisma.dialplanContext.delete({ where: { id } });
    await audit(req, { action: 'dialplan.delete', objectType: 'dialplan_context', objectId: id, objectLabel: existing.name, result: 'SUCCESS' });
    reply.code(204);
  });
}
