import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISSIONS as P, compileDialplan, hasAnyPermission } from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { forbidden, notFound, parse } from '../../lib/errors.js';
import { applyServerConfig, rollbackToVersion, validateServerConfig } from './pipeline.js';
import { collectDraft } from './collect.js';
import { emitToOrg } from '../realtime/hub.js';

const CONFIGURE = [P.TRUNKS_CONFIGURE, P.ENDPOINTS_CONFIGURE, P.ROUTES_CONFIGURE, P.DIALPLAN_CONFIGURE];

export async function configRoutes(app: FastifyInstance) {
  const anyConfigure = async (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) => {
    await app.authenticate(req, reply);
    if (!hasAnyPermission(req.auth!.perms, CONFIGURE)) throw forbidden();
  };

  async function ownServer(org: string, serverId: string) {
    const s = await prisma.asteriskServer.findFirst({ where: { id: serverId, organizationId: org } });
    if (!s) throw notFound('Asterisk server');
    return s;
  }

  /** Pending (unpublished) changes per object type. */
  app.get('/config/pending', { preHandler: anyConfigure }, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
    await ownServer(req.auth!.org, serverId);
    const [counts] = await prisma.$queryRaw<Array<Record<string, number>>>`
      SELECT
        (SELECT count(*)::int FROM app.sip_endpoints     WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS endpoints,
        (SELECT count(*)::int FROM app.sip_aors          WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS aors,
        (SELECT count(*)::int FROM app.sip_auths         WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS auths,
        (SELECT count(*)::int FROM app.sip_identifies    WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS identifies,
        (SELECT count(*)::int FROM app.sip_registrations WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS registrations,
        (SELECT count(*)::int FROM app.sip_transports    WHERE server_id = ${serverId}::uuid AND published_hash IS DISTINCT FROM draft_hash) AS transports`;
    const pending: Record<string, unknown> = { serverId, ...counts };
    const last = await prisma.configurationVersion.findFirst({ where: { serverId, status: 'APPLIED' }, orderBy: { version: 'desc' }, select: { version: true, dialplanHash: true, appliedAt: true } });
    pending['lastApplied'] = last;
    return pending;
  });

  app.post('/config/validate', { preHandler: anyConfigure }, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.body);
    const server = await ownServer(req.auth!.org, serverId);
    const { issues } = await validateServerConfig(serverId, server.versionMajor ?? 22, server.strictCatalog);
    return { ok: !issues.some((i) => i.severity === 'error'), issues };
  });

  app.post('/config/apply', { preHandler: anyConfigure, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ serverId: z.string().uuid(), summary: z.string().max(500).optional() }), req.body);
    await ownServer(req.auth!.org, body.serverId);
    const org = req.auth!.org;
    return applyServerConfig(body.serverId, {
      req,
      summary: body.summary,
      onProgress: (step) => emitToOrg(org, 'config.job', { serverId: body.serverId, ...step }),
    });
  });

  app.get('/config/preview/dialplan', { preHandler: app.requirePermission(P.DIALPLAN_CONFIGURE) }, async (req) => {
    const { serverId } = parse(z.object({ serverId: z.string().uuid() }), req.query);
    await ownServer(req.auth!.org, serverId);
    const draft = await collectDraft(serverId, 0);
    const r = compileDialplan(draft.dialplan);
    return { text: r.text, issues: [...draft.issues, ...r.issues], contexts: r.contexts };
  });

  app.get('/config/versions', { preHandler: app.requirePermission(P.CONFIG_VIEW) }, async (req) => {
    const q = parse(z.object({ serverId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    await ownServer(req.auth!.org, q.serverId);
    return prisma.configurationVersion.findMany({
      where: { serverId: q.serverId },
      select: { id: true, version: true, status: true, summary: true, changes: true, error: true, createdAt: true, appliedAt: true, changedBy: { select: { id: true, displayName: true } } },
      orderBy: { version: 'desc' },
      take: q.limit,
    });
  });

  app.get('/config/versions/:id', { preHandler: app.requirePermission(P.CONFIG_VIEW) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const v = await prisma.configurationVersion.findFirst({ where: { id, organizationId: req.auth!.org }, include: { changedBy: { select: { displayName: true } } } });
    if (!v) throw notFound('Version');
    const { secretsEnc: _s, ...rest } = v; // secrets never leave the server
    return rest;
  });

  app.get('/config/versions/:a/diff/:b', { preHandler: app.requirePermission(P.CONFIG_VIEW) }, async (req) => {
    const { a, b } = parse(z.object({ a: z.string().uuid(), b: z.string().uuid() }), req.params);
    const [va, vb] = await Promise.all([a, b].map((id) => prisma.configurationVersion.findFirst({ where: { id, organizationId: req.auth!.org } })));
    if (!va || !vb) throw notFound('Version');
    const sa = va.snapshot as { tables: Record<string, Array<Record<string, unknown>>>; dialplan: string; transports: string };
    const sb = vb.snapshot as typeof sa;
    const tableDiff: Record<string, { added: string[]; removed: string[]; changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }> }> = {};
    for (const table of new Set([...Object.keys(sa.tables ?? {}), ...Object.keys(sb.tables ?? {})])) {
      const ma = new Map((sa.tables[table] ?? []).map((r) => [String(r['id']), r]));
      const mb = new Map((sb.tables[table] ?? []).map((r) => [String(r['id']), r]));
      const d = { added: [] as string[], removed: [] as string[], changed: [] as Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }> };
      for (const [id, rb] of mb) {
        const ra = ma.get(id);
        if (!ra) { d.added.push(id); continue; }
        const fields = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => ra[k] !== rb[k]).map((k) => ({ field: k, from: ra[k], to: rb[k] }));
        if (fields.length) d.changed.push({ id, fields });
      }
      for (const id of ma.keys()) if (!mb.has(id)) d.removed.push(id);
      if (d.added.length || d.removed.length || d.changed.length) tableDiff[table] = d;
    }
    return { from: va.version, to: vb.version, tables: tableDiff, dialplan: { from: sa.dialplan, to: sb.dialplan }, transports: { from: sa.transports, to: sb.transports } };
  });

  app.post('/config/versions/:id/rollback', { preHandler: app.requirePermission(P.SYSTEM_MANAGE) }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const v = await prisma.configurationVersion.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!v) throw notFound('Version');
    return rollbackToVersion(id, req);
  });
}
