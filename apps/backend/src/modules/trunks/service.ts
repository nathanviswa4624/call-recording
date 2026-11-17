import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { composeTrunkObjects, isIpOrCidr, validatePjsipObject, type TrunkTemplateDefaults } from '@echelons/shared';
import { prisma, withTenant, type Tx } from '../../lib/prisma.js';
import { AppError, notFound } from '../../lib/errors.js';
import { SecretBox, hashObject, secretFingerprint } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { audit } from '../audit/service.js';
import { authAad, trunkAad } from '../config/collect.js';

const NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}$/, 'letters, digits, _ . - (max 40)');
const CONTEXT = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/);
const HOST = z.string().min(1).max(253).refine((h) => isIpOrCidr(h) && !h.includes('/') || /^[A-Za-z0-9.-]+$/.test(h), 'must be an IP address or hostname');

export const trunkInput = z.object({
  name: NAME,
  templateId: z.string().uuid().nullish(),
  host: HOST,
  port: z.number().int().min(1).max(65535).default(5060),
  protocol: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  transportName: NAME,
  authMode: z.enum(['NONE', 'IP', 'USERPASS']).default('IP'),
  sipMode: z.enum(['PEER', 'REGISTER_OUTBOUND', 'ACCEPT_REGISTRATION']).default('PEER'),
  username: z.string().max(80).nullish(),
  /** Omit to keep the existing password on update. */
  password: z.string().min(1).max(128).optional(),
  realm: z.string().max(80).nullish(),
  remoteDomain: z.string().max(253).nullish(),
  inboundContext: CONTEXT,
  outboundContext: CONTEXT.nullish(),
  matchNetworks: z.array(z.string().refine(isIpOrCidr, 'must be an IP or CIDR')).max(50).default([]),
  qualifyFrequency: z.number().int().min(0).max(86400).default(60),
  overrides: z.object({
    endpoint: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    aor: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    identify: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    registration: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  }).default({}),
  recordingPolicyId: z.string().uuid().nullish(),
  enabled: z.boolean().default(true),
}).superRefine((t, ctx) => {
  if (t.authMode === 'USERPASS' && !t.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'username is required for username/password auth' });
  if (t.sipMode === 'REGISTER_OUTBOUND' && t.authMode !== 'USERPASS') ctx.addIssue({ code: 'custom', path: ['authMode'], message: 'outbound registration requires username/password auth' });
  if (t.sipMode === 'ACCEPT_REGISTRATION' && t.authMode !== 'USERPASS') ctx.addIssue({ code: 'custom', path: ['authMode'], message: 'accepting registrations requires username/password auth' });
});
export type TrunkInput = z.infer<typeof trunkInput>;

/** Public DTO: never includes the password. */
export function trunkDto<T extends { passwordEnc: string | null }>(t: T) {
  const { passwordEnc, ...rest } = t;
  return { ...rest, hasPassword: Boolean(passwordEnc) };
}

/**
 * Regenerate PJSIP draft objects managed by a trunk (endpoint/aor/auth/identify/registration).
 * Runs inside the caller's transaction.
 */
async function regenerateObjects(tx: Tx, trunkId: string, serverId: string, organizationId: string, def: TrunkInput, plainPassword: string | undefined, templateDefaults: TrunkTemplateDefaults | undefined, asteriskMajor: number) {
  const box = new SecretBox(env().ENCRYPTION_KEY);
  const objects = composeTrunkObjects({
    name: def.name, host: def.host, port: def.port, protocol: def.protocol, transport: def.transportName,
    authMode: def.authMode, sipMode: def.sipMode, username: def.username, password: plainPassword ?? 'placeholder-for-validation',
    realm: def.realm, remoteDomain: def.remoteDomain, inboundContext: def.inboundContext,
    matchNetworks: def.matchNetworks, qualifyFrequency: def.qualifyFrequency,
    template: templateDefaults, overrides: def.overrides,
  });

  const errors = objects.flatMap((o) => validatePjsipObject(o.type, o.name, o.params, { asteriskMajor })).filter((i) => i.severity === 'error');
  if (errors.length) throw new AppError('VALIDATION_FAILED', 'Generated PJSIP configuration is invalid', errors);

  // Names must not collide with objects not managed by this trunk.
  const names = objects.map((o) => o.name);
  const clash = await tx.sipEndpoint.findFirst({ where: { serverId, name: { in: names }, NOT: { managedByTrunkId: trunkId } } });
  if (clash) throw new AppError('CONFLICT', `An endpoint named "${clash.name}" already exists and is not managed by this trunk`);

  // Remove previous generated objects, then recreate (keeps names stable on rename too).
  const where = { managedByTrunkId: trunkId };
  await tx.sipEndpoint.deleteMany({ where });
  await tx.sipAor.deleteMany({ where });
  await tx.sipAuth.deleteMany({ where });
  await tx.sipIdentify.deleteMany({ where });
  await tx.sipRegistration.deleteMany({ where });

  const base = { organizationId, serverId, managedByTrunkId: trunkId, origin: 'TRUNK_GENERATED' as const };
  for (const o of objects) {
    const params = o.params as Prisma.InputJsonValue;
    const draftHash = hashObject({ type: o.type, name: o.name, params: o.type === 'auth' ? { ...o.params, password: undefined } : o.params });
    switch (o.type) {
      case 'endpoint':
        await tx.sipEndpoint.create({ data: { ...base, name: o.name, params, enabled: def.enabled, draftHash } });
        break;
      case 'aor':
        await tx.sipAor.create({ data: { ...base, name: o.name, params, draftHash } });
        break;
      case 'identify':
        await tx.sipIdentify.create({ data: { ...base, name: o.name, endpointName: String(o.params['endpoint']), params: { ...o.params, endpoint: undefined } as Prisma.InputJsonValue, draftHash } });
        break;
      case 'registration':
        await tx.sipRegistration.create({ data: { ...base, name: o.name, params, draftHash } });
        break;
      case 'auth': {
        const created = await tx.sipAuth.create({
          data: { ...base, name: o.name, authType: 'userpass', username: def.username ?? null, realm: def.realm ?? null, params: {}, draftHash },
        });
        if (!plainPassword) throw new AppError('VALIDATION_FAILED', 'password is required for username/password auth');
        await tx.sipAuth.update({ where: { id: created.id }, data: { secretEnc: box.encrypt(plainPassword, authAad(created.id)), draftHash: hashObject({ draftHash, pw: secretFingerprint(plainPassword) }) } });
        break;
      }
      default:
        break;
    }
  }
}

export async function createTrunk(req: FastifyRequest, pbxId: string, input: TrunkInput) {
  const org = req.auth!.org;
  const pbx = await prisma.pbx.findFirst({ where: { id: pbxId, organizationId: org }, include: { server: true } });
  if (!pbx) throw notFound('PBX');
  const template = input.templateId ? await prisma.trunkTemplate.findUnique({ where: { id: input.templateId } }) : null;
  const box = new SecretBox(env().ENCRYPTION_KEY);
  return withTenant(org, async (tx) => {
    const trunk = await tx.sipTrunk.create({
      data: {
        organizationId: org, pbxId, templateId: input.templateId ?? null, name: input.name, host: input.host, port: input.port,
        protocol: input.protocol, transportName: input.transportName, authMode: input.authMode, sipMode: input.sipMode,
        username: input.username ?? null, realm: input.realm ?? null, remoteDomain: input.remoteDomain ?? null,
        inboundContext: input.inboundContext, outboundContext: input.outboundContext ?? null, matchNetworks: input.matchNetworks,
        qualifyFrequency: input.qualifyFrequency, overrides: input.overrides as Prisma.InputJsonValue,
        recordingPolicyId: input.recordingPolicyId ?? null, enabled: input.enabled,
      },
    });
    if (input.password) {
      await tx.sipTrunk.update({ where: { id: trunk.id }, data: { passwordEnc: box.encrypt(input.password, trunkAad(trunk.id)) } });
    }
    await regenerateObjects(tx, trunk.id, pbx.serverId, org, input, input.password, template?.defaults as TrunkTemplateDefaults | undefined, pbx.server.versionMajor ?? 22);
    await audit(req, { action: 'trunk.create', objectType: 'sip_trunk', objectId: trunk.id, objectLabel: trunk.name, newValue: input, result: 'SUCCESS' }, tx);
    return trunkDto(await tx.sipTrunk.findUniqueOrThrow({ where: { id: trunk.id } }));
  });
}

export async function updateTrunk(req: FastifyRequest, trunkId: string, input: TrunkInput) {
  const org = req.auth!.org;
  const existing = await prisma.sipTrunk.findFirst({ where: { id: trunkId, organizationId: org }, include: { pbx: { include: { server: true } }, template: true } });
  if (!existing) throw notFound('Trunk');
  const box = new SecretBox(env().ENCRYPTION_KEY);
  const password = input.password ?? (existing.passwordEnc ? box.decrypt(existing.passwordEnc, trunkAad(existing.id)) : undefined);
  const template = input.templateId ? await prisma.trunkTemplate.findUnique({ where: { id: input.templateId } }) : existing.template;
  return withTenant(org, async (tx) => {
    const updated = await tx.sipTrunk.update({
      where: { id: trunkId },
      data: {
        templateId: input.templateId ?? existing.templateId, name: input.name, host: input.host, port: input.port, protocol: input.protocol,
        transportName: input.transportName, authMode: input.authMode, sipMode: input.sipMode, username: input.username ?? null,
        realm: input.realm ?? null, remoteDomain: input.remoteDomain ?? null, inboundContext: input.inboundContext,
        outboundContext: input.outboundContext ?? null, matchNetworks: input.matchNetworks, qualifyFrequency: input.qualifyFrequency,
        overrides: input.overrides as Prisma.InputJsonValue, recordingPolicyId: input.recordingPolicyId ?? null, enabled: input.enabled,
        ...(input.password ? { passwordEnc: box.encrypt(input.password, trunkAad(trunkId)) } : {}),
        ...(input.authMode !== 'USERPASS' ? { passwordEnc: null } : {}),
      },
    });
    await regenerateObjects(tx, trunkId, existing.pbx.serverId, org, input, input.authMode === 'USERPASS' ? password : undefined, template?.defaults as TrunkTemplateDefaults | undefined, existing.pbx.server.versionMajor ?? 22);
    const { passwordEnc: _a, ...oldPublic } = existing;
    await audit(req, { action: 'trunk.update', objectType: 'sip_trunk', objectId: trunkId, objectLabel: updated.name, oldValue: oldPublic, newValue: input, result: 'SUCCESS' }, tx);
    return trunkDto(updated);
  });
}

export async function deleteTrunk(req: FastifyRequest, trunkId: string) {
  const org = req.auth!.org;
  const existing = await prisma.sipTrunk.findFirst({ where: { id: trunkId, organizationId: org } });
  if (!existing) throw notFound('Trunk');
  const usedBy = await prisma.route.count({ where: { egressTrunkId: trunkId } });
  if (usedBy) throw new AppError('CONFLICT', `Trunk is the egress of ${usedBy} route(s); reassign them first`);
  await withTenant(org, async (tx) => {
    const where = { managedByTrunkId: trunkId };
    await tx.sipAor.deleteMany({ where });
    await tx.sipAuth.deleteMany({ where });
    await tx.sipIdentify.deleteMany({ where });
    await tx.sipRegistration.deleteMany({ where });
    await tx.sipTrunk.delete({ where: { id: trunkId } }); // endpoints cascade via FK
    await audit(req, { action: 'trunk.delete', objectType: 'sip_trunk', objectId: trunkId, objectLabel: existing.name, oldValue: trunkDto(existing), result: 'SUCCESS' }, tx);
  });
}
