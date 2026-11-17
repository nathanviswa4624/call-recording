import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ALL_PERMISSIONS, PERMISSIONS as P } from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { hashPassword, validatePasswordPolicy } from '../auth/service.js';
import { invalidateUserState } from '../../plugins/auth.js';

const userSelect = {
  id: true, email: true, username: true, displayName: true, status: true, lastLoginAt: true, mfaEnabled: true,
  extensions: true, department: true, createdAt: true,
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
  siteAccess: { select: { siteId: true } },
} as const;

const userInput = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  username: z.string().regex(/^[A-Za-z0-9._-]{3,64}$/),
  displayName: z.string().min(1).max(120),
  password: z.string().max(256).optional(),
  roleIds: z.array(z.string().uuid()).min(1).max(20),
  siteIds: z.array(z.string().uuid()).max(100).default([]),
  extensions: z.array(z.string().regex(/^[0-9*#+]{1,32}$/)).max(50).default([]),
  department: z.string().max(80).nullish(),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
});

export async function userRoutes(app: FastifyInstance) {
  const guard = { preHandler: app.requirePermission(P.USERS_MANAGE) };

  app.get('/users', guard, async (req) => prisma.user.findMany({ where: { organizationId: req.auth!.org }, select: userSelect, orderBy: { displayName: 'asc' } }));

  app.post('/users', guard, async (req, reply) => {
    const b = parse(userInput, req.body);
    if (!b.password) throw new AppError('VALIDATION_FAILED', 'password is required');
    const policy = validatePasswordPolicy(b.password);
    if (policy) throw new AppError('VALIDATION_FAILED', policy);
    const org = req.auth!.org;
    const roles = await prisma.role.findMany({ where: { id: { in: b.roleIds }, OR: [{ organizationId: org }, { organizationId: null }] } });
    if (roles.length !== b.roleIds.length) throw new AppError('VALIDATION_FAILED', 'Unknown role');
    // Only a holder of every permission (super admin) may create users with cli.unsafe/users.manage.
    const passwordHash = await hashPassword(b.password);
    const user = await withTenant(org, async (tx) => {
      const u = await tx.user.create({
        data: {
          organizationId: org, email: b.email, username: b.username, displayName: b.displayName, passwordHash, status: b.status,
          extensions: b.extensions, department: b.department ?? null,
          roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
          siteAccess: { create: b.siteIds.map((siteId) => ({ siteId })) },
        },
        select: userSelect,
      });
      await audit(req, { action: 'user.create', objectType: 'user', objectId: u.id, objectLabel: u.username, newValue: { ...b, password: '••••' }, result: 'SUCCESS' }, tx);
      return u;
    });
    reply.code(201);
    return user;
  });

  app.put('/users/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(userInput, req.body);
    const org = req.auth!.org;
    const existing = await prisma.user.findFirst({ where: { id, organizationId: org }, select: userSelect });
    if (!existing) throw notFound('User');
    if (id === req.auth!.sub && b.status === 'DISABLED') throw new AppError('CONFLICT', 'You cannot disable your own account');
    if (b.password) {
      const policy = validatePasswordPolicy(b.password);
      if (policy) throw new AppError('VALIDATION_FAILED', policy);
    }
    const passwordHash = b.password ? await hashPassword(b.password) : undefined;
    const updated = await withTenant(org, async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userSiteAccess.deleteMany({ where: { userId: id } });
      const u = await tx.user.update({
        where: { id },
        data: {
          email: b.email, username: b.username, displayName: b.displayName, status: b.status, extensions: b.extensions, department: b.department ?? null,
          ...(passwordHash ? { passwordHash } : {}),
          permissionVersion: { increment: 1 },
          roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
          siteAccess: { create: b.siteIds.map((siteId) => ({ siteId })) },
        },
        select: userSelect,
      });
      if (passwordHash || b.status === 'DISABLED') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(req, { action: 'user.update', objectType: 'user', objectId: id, objectLabel: u.username, oldValue: existing, newValue: { ...b, password: b.password ? '••••' : undefined }, result: 'SUCCESS' }, tx);
      return u;
    });
    invalidateUserState(id);
    return updated;
  });

  app.get('/roles', guard, async (req) =>
    prisma.role.findMany({ where: { OR: [{ organizationId: null }, { organizationId: req.auth!.org }] }, include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' } })
      .then((rows) => rows.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.code) }))));

  app.post('/roles', guard, async (req, reply) => {
    const b = parse(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/), name: z.string().min(1).max(80), description: z.string().max(255).nullish(), permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1) }), req.body);
    const org = req.auth!.org;
    const perms = await prisma.permission.findMany({ where: { code: { in: b.permissions } } });
    const role = await prisma.role.create({ data: { organizationId: org, code: b.code, name: b.name, description: b.description ?? null, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } } });
    await audit(req, { action: 'role.create', objectType: 'role', objectId: role.id, objectLabel: role.code, newValue: b, result: 'SUCCESS' });
    reply.code(201);
    return role;
  });

  app.get('/permissions', guard, async () => prisma.permission.findMany({ orderBy: { code: 'asc' } }));

  app.get('/audit', { preHandler: app.requirePermission(P.AUDIT_VIEW) }, async (req) => {
    const q = parse(z.object({
      userId: z.string().uuid().optional(), objectType: z.string().max(60).optional(), objectId: z.string().max(64).optional(), action: z.string().max(80).optional(), ip: z.string().max(64).optional(),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.date().optional(),
    }), req.query);
    return prisma.auditLog.findMany({
      where: {
        organizationId: req.auth!.org, userId: q.userId, objectType: q.objectType, objectId: q.objectId,
        action: q.action ? { startsWith: q.action } : undefined, ip: q.ip,
        createdAt: { gte: q.from, lt: q.before ?? q.to },
      },
      include: { user: { select: { displayName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  });
}
