/**
 * PJSIP draft object CRUD: endpoints, AORs, auths, identifies, registrations, transports.
 * Every object stores its options as a catalog-validated `params` map, so any
 * supported PJSIP option (including "custom" ones) can be managed without code changes.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PERMISSIONS as P, optionsFor, validatePjsipObject, type PjsipObjectType, type ParamValue } from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { SecretBox, hashObject, secretFingerprint } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { audit, diffObjects } from '../audit/service.js';
import { authAad } from '../config/collect.js';

const paramValue = z.union([z.string().max(1024), z.number(), z.boolean(), z.null()]);
const NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,79}$/);

type Kind = 'endpoints' | 'aors' | 'identifies' | 'registrations';
const KIND_TYPE: Record<Kind, PjsipObjectType> = { endpoints: 'endpoint', aors: 'aor', identifies: 'identify', registrations: 'registration' };

async function serverFor(req: FastifyRequest, serverId: string) {
  const s = await prisma.asteriskServer.findFirst({ where: { id: serverId, organizationId: req.auth!.org } });
  if (!s) throw notFound('Asterisk server');
  return s;
}

function validateOrThrow(type: PjsipObjectType, name: string, params: Record<string, ParamValue>, major: number, strict: boolean) {
  const issues = validatePjsipObject(type, name, params, { asteriskMajor: major, strictCatalog: strict });
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    const unsupported = errors.some((e) => e.code === 'UNSUPPORTED_PARAMETER');
    throw new AppError(unsupported ? 'UNSUPPORTED_PARAMETER' : 'VALIDATION_FAILED', `Invalid ${type} configuration`, errors);
  }
  return issues;
}

/** Thin delegate so the four params-only models can share one implementation. */
function model(kind: Kind) {
  switch (kind) {
    case 'endpoints': return prisma.sipEndpoint as unknown as GenericDelegate;
    case 'aors': return prisma.sipAor as unknown as GenericDelegate;
    case 'identifies': return prisma.sipIdentify as unknown as GenericDelegate;
    case 'registrations': return prisma.sipRegistration as unknown as GenericDelegate;
  }
}
interface GenericDelegate {
  findMany(a: unknown): Promise<Array<Record<string, unknown>>>;
  findFirst(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  delete(a: unknown): Promise<unknown>;
}

export async function pjsipRoutes(app: FastifyInstance) {
  /** Version-filtered option catalog for building forms. */
  app.get('/pjsip/catalog', { preHandler: app.requirePermission(P.ENDPOINTS_VIEW) }, async (req) => {
    const q = parse(z.object({ object: z.enum(['endpoint', 'aor', 'auth', 'identify', 'transport', 'registration', 'global', 'domain_alias']), serverId: z.string().uuid() }), req.query);
    const s = await serverFor(req, q.serverId);
    return {
      asteriskMajor: s.versionMajor ?? 22,
      options: optionsFor(q.object, s.versionMajor ?? 22).map((o) => ({
        name: o.name, type: o.type.t, common: Boolean(o.common), since: o.since,
        values: o.type.t === 'enum' ? o.type.values : undefined,
        min: o.type.t === 'int' ? o.type.min : undefined, max: o.type.t === 'int' ? o.type.max : undefined,
      })),
    };
  });

  for (const kind of ['endpoints', 'aors', 'identifies', 'registrations'] as Kind[]) {
    const type = KIND_TYPE[kind];
    const body = z.object({
      serverId: z.string().uuid(),
      name: NAME,
      params: z.record(paramValue).default({}),
      ...(kind === 'identifies' ? { endpointName: NAME } : {}),
      ...(kind === 'endpoints' ? { enabled: z.boolean().default(true) } : {}),
    });

    app.get(`/pjsip/${kind}`, { preHandler: app.requirePermission(P.ENDPOINTS_VIEW) }, async (req) => {
      const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
      await serverFor(req, serverId);
      const rows = await model(kind).findMany({ where: { serverId }, orderBy: { name: 'asc' } });
      return rows.map((r) => ({ ...r, pending: r['publishedHash'] !== r['draftHash'] }));
    });

    app.get(`/pjsip/${kind}/:id`, { preHandler: app.requirePermission(P.ENDPOINTS_VIEW) }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const row = await model(kind).findFirst({ where: { id, organizationId: req.auth!.org } });
      if (!row) throw notFound(type);
      return row;
    });

    app.post(`/pjsip/${kind}`, { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
      const b = parse(body, req.body) as z.infer<typeof body> & { endpointName?: string; enabled?: boolean };
      const s = await serverFor(req, b.serverId);
      const params = { ...b.params, ...(b.endpointName ? { endpoint: b.endpointName } : {}) };
      const warnings = validateOrThrow(type, b.name, params, s.versionMajor ?? 22, s.strictCatalog);
      const org = req.auth!.org;
      const created = await withTenant(org, async () => {
        const row = await model(kind).create({
          data: {
            organizationId: org, serverId: s.id, name: b.name, params: b.params as Prisma.InputJsonValue,
            ...(b.endpointName ? { endpointName: b.endpointName } : {}),
            ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
            draftHash: hashObject({ type, name: b.name, params }),
          },
        });
        await audit(req, { action: `pjsip.${type}.create`, objectType: `pjsip_${type}`, objectId: String(row['id']), objectLabel: b.name, newValue: params, result: 'SUCCESS' });
        return row;
      }).catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', `${type} "${b.name}" already exists`);
        throw e;
      });
      reply.code(201);
      return { ...created, warnings };
    });

    app.put(`/pjsip/${kind}/:id`, { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const b = parse(body.omit({ serverId: true }), req.body) as { name: string; params: Record<string, ParamValue>; endpointName?: string; enabled?: boolean };
      const org = req.auth!.org;
      const existing = await model(kind).findFirst({ where: { id, organizationId: org } });
      if (!existing) throw notFound(type);
      const s = await serverFor(req, String(existing['serverId']));
      const params = { ...b.params, ...(b.endpointName ? { endpoint: b.endpointName } : {}) };
      const warnings = validateOrThrow(type, b.name, params, s.versionMajor ?? 22, s.strictCatalog);
      const updated = await withTenant(org, async () => {
        const row = await model(kind).update({
          where: { id },
          data: {
            name: b.name, params: b.params as Prisma.InputJsonValue,
            ...(b.endpointName ? { endpointName: b.endpointName } : {}),
            ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
            draftHash: hashObject({ type, name: b.name, params }),
          },
        });
        await audit(req, {
          action: `pjsip.${type}.update`, objectType: `pjsip_${type}`, objectId: id, objectLabel: b.name,
          oldValue: existing['params'], newValue: { params, changes: diffObjects(existing['params'], b.params) }, result: 'SUCCESS',
        });
        return row;
      });
      return { ...updated, warnings, note: existing['managedByTrunkId'] ? 'This object is generated by a trunk; edit the trunk overrides to keep changes on regeneration.' : undefined };
    });

    app.delete(`/pjsip/${kind}/:id`, { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      const existing = await model(kind).findFirst({ where: { id, organizationId: req.auth!.org } });
      if (!existing) throw notFound(type);
      if (existing['managedByTrunkId']) throw new AppError('CONFLICT', 'Generated by a trunk — delete or edit the trunk instead');
      await model(kind).delete({ where: { id } });
      await audit(req, { action: `pjsip.${type}.delete`, objectType: `pjsip_${type}`, objectId: id, objectLabel: String(existing['name']), oldValue: existing['params'], result: 'SUCCESS' });
      reply.code(204);
    });
  }

  // ---------------- Auths (secret handling) ----------------
  const authBody = z.object({
    serverId: z.string().uuid(),
    name: NAME,
    authType: z.enum(['userpass', 'md5', 'google_oauth']).default('userpass'),
    username: z.string().max(80).nullish(),
    /** Omit on update to keep the stored secret. */
    secret: z.string().min(1).max(256).optional(),
    realm: z.string().max(80).nullish(),
    params: z.record(paramValue).default({}),
  });

  const authDto = (a: { secretEnc: string | null } & Record<string, unknown>) => {
    const { secretEnc, ...rest } = a;
    return { ...rest, hasSecret: Boolean(secretEnc), pending: rest['publishedHash'] !== rest['draftHash'] };
  };

  app.get('/pjsip/auths', { preHandler: app.requirePermission(P.ENDPOINTS_VIEW) }, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
    await serverFor(req, serverId);
    return (await prisma.sipAuth.findMany({ where: { serverId }, orderBy: { name: 'asc' } })).map(authDto);
  });

  app.post('/pjsip/auths', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
    const b = parse(authBody, req.body);
    const s = await serverFor(req, b.serverId);
    const secretKey = b.authType === 'md5' ? 'md5_cred' : 'password';
    validateOrThrow('auth', b.name, { ...b.params, auth_type: b.authType, username: b.username, realm: b.realm, [secretKey]: b.secret }, s.versionMajor ?? 22, s.strictCatalog);
    const box = new SecretBox(env().ENCRYPTION_KEY);
    const org = req.auth!.org;
    const row = await withTenant(org, async (tx) => {
      const created = await tx.sipAuth.create({ data: { organizationId: org, serverId: s.id, name: b.name, authType: b.authType, username: b.username ?? null, realm: b.realm ?? null, params: b.params as Prisma.InputJsonValue } });
      const updated = await tx.sipAuth.update({
        where: { id: created.id },
        data: {
          secretEnc: b.secret ? box.encrypt(b.secret, authAad(created.id)) : null,
          draftHash: hashObject({ name: b.name, t: b.authType, u: b.username, r: b.realm, p: b.params, s: b.secret ? secretFingerprint(b.secret) : null }),
        },
      });
      await audit(req, { action: 'pjsip.auth.create', objectType: 'pjsip_auth', objectId: created.id, objectLabel: b.name, newValue: { ...b, secret: b.secret ? '••••' : undefined }, result: 'SUCCESS' }, tx);
      return updated;
    });
    reply.code(201);
    return authDto(row);
  });

  app.put('/pjsip/auths/:id', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(authBody.omit({ serverId: true }), req.body);
    const org = req.auth!.org;
    const existing = await prisma.sipAuth.findFirst({ where: { id, organizationId: org } });
    if (!existing) throw notFound('auth');
    if (existing.managedByTrunkId) throw new AppError('CONFLICT', 'Generated by a trunk — change the password on the trunk');
    const s = await serverFor(req, existing.serverId);
    const box = new SecretBox(env().ENCRYPTION_KEY);
    const secret = b.secret ?? (existing.secretEnc ? box.decrypt(existing.secretEnc, authAad(id)) : undefined);
    const secretKey = b.authType === 'md5' ? 'md5_cred' : 'password';
    validateOrThrow('auth', b.name, { ...b.params, auth_type: b.authType, username: b.username, realm: b.realm, [secretKey]: secret }, s.versionMajor ?? 22, s.strictCatalog);
    const row = await prisma.sipAuth.update({
      where: { id },
      data: {
        name: b.name, authType: b.authType, username: b.username ?? null, realm: b.realm ?? null, params: b.params as Prisma.InputJsonValue,
        ...(b.secret ? { secretEnc: box.encrypt(b.secret, authAad(id)) } : {}),
        draftHash: hashObject({ name: b.name, t: b.authType, u: b.username, r: b.realm, p: b.params, s: secret ? secretFingerprint(secret) : null }),
      },
    });
    await audit(req, { action: 'pjsip.auth.update', objectType: 'pjsip_auth', objectId: id, objectLabel: b.name, oldValue: { username: existing.username, realm: existing.realm }, newValue: { username: b.username, realm: b.realm, secretChanged: Boolean(b.secret) }, result: 'SUCCESS' });
    return authDto(row);
  });

  app.delete('/pjsip/auths/:id', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const existing = await prisma.sipAuth.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('auth');
    if (existing.managedByTrunkId) throw new AppError('CONFLICT', 'Generated by a trunk — delete or edit the trunk instead');
    await prisma.sipAuth.delete({ where: { id } });
    await audit(req, { action: 'pjsip.auth.delete', objectType: 'pjsip_auth', objectId: id, objectLabel: existing.name, result: 'SUCCESS' });
    reply.code(204);
  });

  // ---------------- Transports ----------------
  const transportBody = z.object({
    serverId: z.string().uuid(),
    name: NAME,
    protocol: z.enum(['udp', 'tcp', 'tls', 'ws', 'wss']),
    bindAddress: z.string().max(64).default('0.0.0.0'),
    bindPort: z.number().int().min(1).max(65535).default(5060),
    params: z.record(paramValue).default({}),
  });

  app.get('/pjsip/transports', { preHandler: app.requirePermission(P.ENDPOINTS_VIEW) }, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
    await serverFor(req, serverId);
    const rows = await prisma.sipTransport.findMany({ where: { serverId }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ ...r, pending: r.publishedHash !== r.draftHash }));
  });

  app.post('/pjsip/transports', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
    const b = parse(transportBody, req.body);
    const s = await serverFor(req, b.serverId);
    const params = { ...b.params, protocol: b.protocol, bind: `${b.bindAddress}:${b.bindPort}` };
    const warnings = validateOrThrow('transport', b.name, params, s.versionMajor ?? 22, s.strictCatalog);
    const row = await prisma.sipTransport.create({
      data: { organizationId: req.auth!.org, serverId: s.id, name: b.name, protocol: b.protocol, bindAddress: b.bindAddress, bindPort: b.bindPort, params: b.params as Prisma.InputJsonValue, draftHash: hashObject(params) },
    });
    await audit(req, { action: 'pjsip.transport.create', objectType: 'pjsip_transport', objectId: row.id, objectLabel: b.name, newValue: params, result: 'SUCCESS' });
    reply.code(201);
    return { ...row, warnings, restartRequired: true };
  });

  app.put('/pjsip/transports/:id', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(transportBody.omit({ serverId: true }), req.body);
    const existing = await prisma.sipTransport.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('transport');
    const s = await serverFor(req, existing.serverId);
    const params = { ...b.params, protocol: b.protocol, bind: `${b.bindAddress}:${b.bindPort}` };
    const warnings = validateOrThrow('transport', b.name, params, s.versionMajor ?? 22, s.strictCatalog);
    const row = await prisma.sipTransport.update({ where: { id }, data: { name: b.name, protocol: b.protocol, bindAddress: b.bindAddress, bindPort: b.bindPort, params: b.params as Prisma.InputJsonValue, draftHash: hashObject(params) } });
    await audit(req, { action: 'pjsip.transport.update', objectType: 'pjsip_transport', objectId: id, objectLabel: b.name, oldValue: { protocol: existing.protocol, bind: `${existing.bindAddress}:${existing.bindPort}`, ...(existing.params as object) }, newValue: params, result: 'SUCCESS' });
    return { ...row, warnings, restartRequired: true };
  });

  app.delete('/pjsip/transports/:id', { preHandler: app.requirePermission(P.ENDPOINTS_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const existing = await prisma.sipTransport.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('transport');
    const inUse = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM app.sip_endpoints WHERE server_id = ${existing.serverId}::uuid AND params->>'transport' = ${existing.name}`;
    if ((inUse[0]?.n ?? 0) > 0) throw new AppError('CONFLICT', `Transport is used by ${inUse[0]!.n} endpoint(s)`);
    await prisma.sipTransport.delete({ where: { id } });
    await audit(req, { action: 'pjsip.transport.delete', objectType: 'pjsip_transport', objectId: id, objectLabel: existing.name, result: 'SUCCESS' });
    reply.code(204);
  });
}
