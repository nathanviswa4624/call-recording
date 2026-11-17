import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISSIONS as P } from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { connectorFor } from '../connector/client.js';
import { createTrunk, deleteTrunk, trunkDto, trunkInput, updateTrunk } from './service.js';

const pbxInput = z.object({
  siteId: z.string().uuid(),
  serverId: z.string().uuid(),
  name: z.string().min(1).max(80),
  code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,31}$/, 'letters, digits, _ - (max 32)'),
  description: z.string().max(500).nullish(),
  vendor: z.string().min(1).max(60),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(5060),
  protocol: z.enum(['udp', 'tcp', 'tls']).default('udp'),
  sipMode: z.enum(['PEER', 'REGISTER_OUTBOUND', 'ACCEPT_REGISTRATION']).default('PEER'),
  authMode: z.enum(['NONE', 'IP', 'USERPASS']).default('IP'),
  inboundContext: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/),
  outboundContext: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/).nullish(),
  recordingPolicyId: z.string().uuid().nullish(),
  enabled: z.boolean().default(true),
});

const idParam = z.object({ id: z.string().uuid() });

export async function trunkRoutes(app: FastifyInstance) {
  // ---------------- PBX connections ----------------
  app.get('/pbxs', { preHandler: app.requirePermission(P.TRUNKS_VIEW) }, async (req) => {
    const a = req.auth!;
    return prisma.pbx.findMany({
      where: { organizationId: a.org, ...(a.sites.length ? { siteId: { in: a.sites } } : {}) },
      include: { _count: { select: { trunks: true, routes: true } }, site: { select: { id: true, name: true } }, server: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  });

  app.get('/pbxs/:id', { preHandler: app.requirePermission(P.TRUNKS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const pbx = await prisma.pbx.findFirst({ where: { id, organizationId: req.auth!.org }, include: { trunks: true, routes: { include: { patterns: true } } } });
    if (!pbx) throw notFound('PBX');
    return { ...pbx, trunks: pbx.trunks.map(trunkDto) };
  });

  app.post('/pbxs', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req, reply) => {
    const body = parse(pbxInput, req.body);
    const org = req.auth!.org;
    const [site, server] = await Promise.all([
      prisma.site.findFirst({ where: { id: body.siteId, organizationId: org } }),
      prisma.asteriskServer.findFirst({ where: { id: body.serverId, organizationId: org } }),
    ]);
    if (!site || !server) throw new AppError('VALIDATION_FAILED', 'Unknown site or Asterisk server');
    const pbx = await withTenant(org, async (tx) => {
      const created = await tx.pbx.create({ data: { ...body, organizationId: org, description: body.description ?? null, outboundContext: body.outboundContext ?? null, recordingPolicyId: body.recordingPolicyId ?? null } });
      await audit(req, { action: 'pbx.create', objectType: 'pbx', objectId: created.id, objectLabel: created.name, newValue: body, result: 'SUCCESS' }, tx);
      return created;
    });
    reply.code(201);
    return pbx;
  });

  app.patch('/pbxs/:id', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(pbxInput.partial(), req.body);
    const org = req.auth!.org;
    const existing = await prisma.pbx.findFirst({ where: { id, organizationId: org } });
    if (!existing) throw notFound('PBX');
    return withTenant(org, async (tx) => {
      const updated = await tx.pbx.update({ where: { id }, data: body });
      await audit(req, { action: 'pbx.update', objectType: 'pbx', objectId: id, objectLabel: updated.name, oldValue: existing, newValue: updated, result: 'SUCCESS' }, tx);
      return updated;
    });
  });

  app.delete('/pbxs/:id', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const org = req.auth!.org;
    const existing = await prisma.pbx.findFirst({ where: { id, organizationId: org }, include: { _count: { select: { trunks: true } } } });
    if (!existing) throw notFound('PBX');
    if (existing._count.trunks) throw new AppError('CONFLICT', 'Delete the PBX trunks first');
    await withTenant(org, async (tx) => {
      await tx.pbx.delete({ where: { id } });
      await audit(req, { action: 'pbx.delete', objectType: 'pbx', objectId: id, objectLabel: existing.name, oldValue: existing, result: 'SUCCESS' }, tx);
    });
    reply.code(204);
  });

  // ---------------- Trunks ----------------
  app.get('/pbxs/:id/trunks', { preHandler: app.requirePermission(P.TRUNKS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const rows = await prisma.sipTrunk.findMany({ where: { pbxId: id, organizationId: req.auth!.org }, orderBy: { name: 'asc' } });
    return rows.map(trunkDto);
  });

  app.get('/trunks', { preHandler: app.requirePermission(P.TRUNKS_VIEW) }, async (req) => {
    const rows = await prisma.sipTrunk.findMany({ where: { organizationId: req.auth!.org }, include: { pbx: { select: { id: true, name: true, code: true, vendor: true } } }, orderBy: { name: 'asc' } });
    return rows.map(trunkDto);
  });

  app.post('/pbxs/:id/trunks', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(trunkInput, req.body);
    reply.code(201);
    return createTrunk(req, id, body);
  });

  app.put('/trunks/:id', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req) => {
    const { id } = parse(idParam, req.params);
    return updateTrunk(req, id, parse(trunkInput, req.body));
  });

  app.delete('/trunks/:id', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await deleteTrunk(req, id);
    reply.code(204);
  });

  /** Connectivity test (spec §48): DNS, TCP/UDP, SIP OPTIONS (qualify), endpoint availability, optional test call. */
  app.post('/trunks/:id/test', { preHandler: app.requirePermission(P.TRUNKS_CONFIGURE), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ testNumber: z.string().regex(/^[0-9*#+]{1,32}$/).optional() }), req.body ?? {});
    const trunk = await prisma.sipTrunk.findFirst({ where: { id, organizationId: req.auth!.org }, include: { pbx: true } });
    if (!trunk) throw notFound('Trunk');
    const c = await connectorFor(trunk.pbx.serverId);
    const results: Record<string, { status: 'OK' | 'FAILED' | 'SKIPPED'; detail?: string }> = {};

    const net = (await c.netCheck(trunk.host, trunk.port, trunk.protocol as 'udp' | 'tcp' | 'tls').catch((e: Error) => ({ error: e.message }))) as Record<string, unknown>;
    results['DNS'] = net['dns'] ? { status: 'OK', detail: String(net['dns']) } : { status: 'FAILED', detail: String(net['error'] ?? net['dnsError'] ?? 'resolution failed') };
    results[trunk.protocol.toUpperCase()] = net['reachable'] ? { status: 'OK', detail: `${net['rttMs'] ?? '?'} ms` } : { status: 'FAILED', detail: String(net['reachError'] ?? 'unreachable') };

    const ep = await c.ami('PJSIPShowEndpoint', { Endpoint: trunk.name }).catch((e: Error) => ({ response: 'Error', message: e.message, events: [], fields: {} }));
    const detail = ep.events.find((e) => e['Event'] === 'EndpointDetail');
    results['PJSIP endpoint'] = ep.response === 'Success' ? { status: 'OK', detail: detail?.['DeviceState'] ?? 'loaded' } : { status: 'FAILED', detail: ep.message ?? 'endpoint not loaded — apply configuration first' };

    const q = await c.cli(`pjsip qualify ${trunk.name}`).catch((e: Error) => ({ output: `error: ${e.message}` }));
    const contacts = await c.ami('PJSIPShowContacts').catch(() => ({ events: [] as Array<Record<string, string>> }));
    const contact = contacts.events.find((e) => e['Event'] === 'ContactList' && e['Aor'] === trunk.name);
    if (contact) {
      const ok = /^(Reachable|Available)$/i.test(contact['Status'] ?? '');
      results['SIP OPTIONS'] = ok ? { status: 'OK', detail: `200 OK (${Math.round(Number(contact['RoundtripUsec'] ?? 0) / 1000)} ms)` } : { status: 'FAILED', detail: contact['Status'] ?? q.output.trim() };
    } else results['SIP OPTIONS'] = { status: 'FAILED', detail: 'no contact for AOR (is qualify_frequency > 0?)' };

    if (body.testNumber) {
      const call = await c.testCall(trunk.name, body.testNumber).catch((e: Error) => ({ ok: false, error: e.message }));
      results['Test call'] = (call as { ok?: boolean }).ok ? { status: 'OK', detail: 'SUCCESS' } : { status: 'FAILED', detail: String((call as { error?: string; cause?: string }).error ?? (call as { cause?: string }).cause ?? 'failed') };
    } else results['Test call'] = { status: 'SKIPPED' };

    const allOk = Object.values(results).every((r) => r.status !== 'FAILED');
    await prisma.sipTrunk.update({ where: { id }, data: { status: allOk ? 'REACHABLE' : 'UNREACHABLE' } });
    await prisma.pbx.update({ where: { id: trunk.pbxId }, data: { lastCheckAt: new Date(), lastCheckResult: results, status: allOk ? 'REACHABLE' : 'UNREACHABLE' } });
    return { trunk: trunk.name, ok: allOk, results };
  });

  // ---------------- Templates ----------------
  app.get('/trunk-templates', { preHandler: app.requirePermission(P.TRUNKS_VIEW) }, async (req) =>
    prisma.trunkTemplate.findMany({ where: { OR: [{ organizationId: null }, { organizationId: req.auth!.org }] }, orderBy: [{ builtin: 'desc' }, { name: 'asc' }] }));
}
