import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CLI_COMMANDS, PERMISSIONS as P, checkCliCommand, hasPermission } from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { SecretBox } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { audit } from '../audit/service.js';
import { connectorFor, invalidateConnector } from '../connector/client.js';

const serverQuery = z.object({ serverId: z.string().uuid() });

export async function asteriskRoutes(app: FastifyInstance) {
  async function server(org: string, id: string) {
    const s = await prisma.asteriskServer.findFirst({ where: { id, organizationId: org } });
    if (!s) throw notFound('Asterisk server');
    return s;
  }

  app.get('/asterisk/servers', { preHandler: app.requirePermission(P.SYSTEM_VIEW) }, async (req) =>
    prisma.asteriskServer.findMany({
      where: { organizationId: req.auth!.org },
      select: { id: true, name: true, siteId: true, connectorUrl: true, versionString: true, versionMajor: true, status: true, lastSeenAt: true, restartRequired: true, strictCatalog: true, recordingBasePath: true, realtimeSchema: true },
    }));

  app.post('/asterisk/servers', { preHandler: app.requirePermission(P.SYSTEM_MANAGE) }, async (req, reply) => {
    const body = parse(z.object({
      siteId: z.string().uuid(),
      name: z.string().min(1).max(80),
      connectorUrl: z.string().url(),
      connectorToken: z.string().min(16).max(256),
      recordingBasePath: z.string().regex(/^\/[A-Za-z0-9_.\/\-]+$/).default('/var/spool/asterisk/recording'),
      realtimeSchema: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).default('asterisk'),
      strictCatalog: z.boolean().default(true),
    }), req.body);
    const org = req.auth!.org;
    if (!(await prisma.site.findFirst({ where: { id: body.siteId, organizationId: org } }))) throw notFound('Site');
    const box = new SecretBox(env().ENCRYPTION_KEY);
    const { connectorToken, ...rest } = body;
    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.asteriskServer.create({ data: { ...rest, organizationId: org, connectorTokenEnc: 'pending' } });
      return tx.asteriskServer.update({ where: { id: s.id }, data: { connectorTokenEnc: box.encrypt(connectorToken, `server:${s.id}`) } });
    });
    await audit(req, { action: 'asterisk_server.create', objectType: 'asterisk_server', objectId: created.id, objectLabel: created.name, newValue: rest, result: 'SUCCESS' });
    reply.code(201);
    const { connectorTokenEnc: _t, ...dto } = created;
    return { ...dto, cdrWatermark: Number(dto.cdrWatermark), celWatermark: Number(dto.celWatermark) };
  });

  app.get('/asterisk/status', { preHandler: app.requirePermission(P.SYSTEM_VIEW) }, async (req) => {
    const { serverId } = parse(serverQuery, req.query);
    const s = await server(req.auth!.org, serverId);
    const c = await connectorFor(serverId);
    const health = await c.health().catch((e: Error) => ({ error: e.message }));
    if ('error' in health) {
      await prisma.asteriskServer.update({ where: { id: serverId }, data: { status: 'UNREACHABLE' } });
      return { server: s.name, connected: false, error: health.error };
    }
    const [sys, channels, endpoints, regs] = await Promise.all([
      c.system().catch(() => null),
      c.ami('CoreShowChannels').catch(() => null),
      c.ami('PJSIPShowEndpoints').catch(() => null),
      c.ami('PJSIPShowRegistrationsOutbound').catch(() => null),
    ]);
    const chanList = channels?.events.filter((e) => e['Event'] === 'CoreShowChannel') ?? [];
    const eps = endpoints?.events.filter((e) => e['Event'] === 'EndpointList') ?? [];
    await prisma.asteriskServer.update({ where: { id: serverId }, data: { status: health.ami ? 'REACHABLE' : 'UNREACHABLE', lastSeenAt: new Date(), versionString: health.version?.raw, versionMajor: health.version?.major } });
    return {
      server: s.name,
      connected: health.ami,
      ari: health.ari,
      version: health.version?.raw ?? null,
      uptimeSec: health.uptimeSec,
      restartRequired: s.restartRequired,
      system: sys,
      activeChannels: chanList.length,
      activeCalls: new Set(chanList.map((c2) => c2['Linkedid'])).size,
      recordingChannels: chanList.filter((c2) => /MixMonitor/i.test(c2['Application'] ?? '')).length,
      endpoints: {
        total: eps.length,
        available: eps.filter((e) => !/Unavailable|Invalid/i.test(e['DeviceState'] ?? '')).length,
        unavailable: eps.filter((e) => /Unavailable/i.test(e['DeviceState'] ?? '')).map((e) => e['ObjectName']),
      },
      registrations: (regs?.events.filter((e) => e['Event'] === 'OutboundRegistrationDetail') ?? []).map((r) => ({ name: r['ObjectName'], status: r['Status'], serverUri: r['ServerUri'] })),
    };
  });

  app.get('/asterisk/cli/commands', { preHandler: app.requirePermission(P.CLI_ACCESS) }, async (req) => {
    const unsafe = hasPermission(req.auth!.perms, P.CLI_UNSAFE);
    return CLI_COMMANDS.filter((c) => c.tier === 'read' || unsafe).map(({ id, tier, example, description }) => ({ id, tier, example, description }));
  });

  app.post('/asterisk/cli', { preHandler: app.requirePermission(P.CLI_ACCESS), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ serverId: z.string().uuid(), command: z.string().min(1).max(200) }), req.body);
    const s = await server(req.auth!.org, body.serverId);
    const check = checkCliCommand(body.command, hasPermission(req.auth!.perms, P.CLI_UNSAFE));
    if (!check.allowed) {
      await audit(req, { action: 'asterisk.cli', objectType: 'asterisk_server', objectId: s.id, objectLabel: body.command.slice(0, 200), result: 'FAILURE', error: check.reason });
      throw new AppError('FORBIDDEN', check.reason);
    }
    const out = await (await connectorFor(s.id)).cli(check.command);
    await audit(req, { action: 'asterisk.cli', objectType: 'asterisk_server', objectId: s.id, objectLabel: check.command, result: 'SUCCESS' });
    return { command: check.command, output: out.output };
  });

  app.post('/asterisk/reload', { preHandler: app.requirePermission(P.SYSTEM_MANAGE, P.CLI_UNSAFE) }, async (req) => {
    const body = parse(z.object({ serverId: z.string().uuid(), module: z.enum(['res_pjsip.so', 'pbx_config.so', 'res_pjsip_outbound_registration.so', 'cdr', 'res_pjsip_endpoint_identifier_ip.so']) }), req.body);
    const s = await server(req.auth!.org, body.serverId);
    const r = await (await connectorFor(s.id)).reload(body.module);
    await audit(req, { action: 'asterisk.reload', objectType: 'asterisk_server', objectId: s.id, objectLabel: body.module, result: r.ok ? 'SUCCESS' : 'FAILURE' });
    return r;
  });

  app.post('/asterisk/restart', { preHandler: app.requirePermission(P.SYSTEM_MANAGE, P.CLI_UNSAFE) }, async (req) => {
    const body = parse(z.object({ serverId: z.string().uuid(), mode: z.enum(['gracefully', 'when convenient']).default('gracefully') }), req.body);
    const s = await server(req.auth!.org, body.serverId);
    const out = await (await connectorFor(s.id)).cli(`core restart ${body.mode}`);
    await prisma.asteriskServer.update({ where: { id: s.id }, data: { restartRequired: false } });
    invalidateConnector(s.id);
    await audit(req, { action: 'asterisk.restart', objectType: 'asterisk_server', objectId: s.id, objectLabel: body.mode, result: 'SUCCESS' });
    return { ok: true, output: out.output };
  });

  /** Live inventory from Asterisk (spec §26/§49). */
  app.get('/asterisk/live/:what', { preHandler: app.requirePermission(P.SYSTEM_VIEW) }, async (req) => {
    const { what } = parse(z.object({ what: z.enum(['endpoints', 'contacts', 'registrations', 'transports', 'channels', 'bridges']) }), req.params);
    const { serverId } = parse(serverQuery, req.query);
    await server(req.auth!.org, serverId);
    const action = { endpoints: 'PJSIPShowEndpoints', contacts: 'PJSIPShowContacts', registrations: 'PJSIPShowRegistrationsOutbound', transports: 'PJSIPShowTransports', channels: 'CoreShowChannels', bridges: 'BridgeList' }[what];
    const r = await (await connectorFor(serverId)).ami(action);
    return r.events.filter((e) => !/Complete$/.test(e['Event'] ?? ''));
  });
}
