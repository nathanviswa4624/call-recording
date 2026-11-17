import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  PERMISSIONS as P, compilePattern, isValidPattern, patternsOverlap, selectRoute, transformNumber, ruleSchema,
  ClassificationEngine, type ClassificationRule,
} from '@echelons/shared';
import { prisma, withTenant } from '../../lib/prisma.js';
import { AppError, notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';

const idParam = z.object({ id: z.string().uuid() });

const patternInput = z.object({
  pattern: z.string().min(1).max(80).refine(isValidPattern, 'invalid Asterisk pattern'),
  prefix: z.string().regex(/^[0-9*#+]{0,10}$/).nullish(),
  stripDigits: z.number().int().min(0).max(40).default(0),
  prepend: z.string().regex(/^[0-9*#+]{0,20}$/).nullish(),
  description: z.string().max(255).nullish(),
  recordingPolicyId: z.string().uuid().nullish(),
  enabled: z.boolean().default(true),
});

const routeInput = z.object({
  routeNumber: z.number().int().min(1).max(999999).optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullish(),
  pbxId: z.string().uuid(),
  direction: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT']),
  priority: z.number().int().min(0).max(9999).default(100),
  egressKind: z.enum(['TRUNK', 'CONTEXT', 'HANGUP']).default('TRUNK'),
  egressTrunkId: z.string().uuid().nullish(),
  egressContext: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/).nullish(),
  callTypeId: z.string().uuid().nullish(),
  recordingPolicyId: z.string().uuid().nullish(),
  callerIdNumber: z.string().regex(/^\+?[0-9]{1,32}$/).nullish(),
  callerIdName: z.string().max(80).regex(/^[^"\r\n;<>]*$/).nullish(),
  dialTimeout: z.number().int().min(1).max(3600).default(60),
  dialOptions: z.string().regex(/^[A-Za-z0-9()^]{0,40}$/).nullish(),
  enabled: z.boolean().default(true),
  patterns: z.array(patternInput).max(200).default([]),
}).superRefine((r, ctx) => {
  if (r.egressKind === 'TRUNK' && !r.egressTrunkId) ctx.addIssue({ code: 'custom', path: ['egressTrunkId'], message: 'egress trunk is required' });
  if (r.egressKind === 'CONTEXT' && !r.egressContext) ctx.addIssue({ code: 'custom', path: ['egressContext'], message: 'egress context is required' });
});

export async function routingRoutes(app: FastifyInstance) {
  app.get('/routes', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) =>
    prisma.route.findMany({
      where: { organizationId: req.auth!.org },
      include: { patterns: true, pbx: { select: { id: true, name: true, code: true } }, egressTrunk: { select: { id: true, name: true } }, callType: true, recordingPolicy: true },
      orderBy: [{ pbxId: 'asc' }, { priority: 'asc' }, { name: 'asc' }],
    }));

  app.get('/routes/:id', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await prisma.route.findFirst({ where: { id, organizationId: req.auth!.org }, include: { patterns: true } });
    if (!r) throw notFound('Route');
    return r;
  });

  async function checkRefs(org: string, body: z.infer<typeof routeInput>) {
    const pbx = await prisma.pbx.findFirst({ where: { id: body.pbxId, organizationId: org } });
    if (!pbx) throw new AppError('VALIDATION_FAILED', 'Unknown PBX');
    if (body.egressTrunkId) {
      const t = await prisma.sipTrunk.findFirst({ where: { id: body.egressTrunkId, organizationId: org }, include: { pbx: true } });
      if (!t) throw new AppError('VALIDATION_FAILED', 'Unknown egress trunk');
      if (t.pbx.serverId !== pbx.serverId) throw new AppError('VALIDATION_FAILED', 'Egress trunk must be on the same Asterisk server as the PBX');
    }
    // Overlap warnings against other routes of the same PBX in the same priority tier.
    const siblings = await prisma.route.findMany({ where: { pbxId: body.pbxId, priority: body.priority, organizationId: org }, include: { patterns: true } });
    const warnings: string[] = [];
    for (const p of body.patterns) {
      const full = `${p.prefix ?? ''}${p.pattern.replace(/^_/, '')}`;
      for (const s of siblings) for (const sp of s.patterns) {
        const other = `${sp.prefix ?? ''}${sp.pattern.replace(/^_/, '')}`;
        if (compilePattern(full).normalized === compilePattern(other).normalized) warnings.push(`Pattern ${full} duplicates route "${s.name}"`);
        else if (patternsOverlap(full, other)) warnings.push(`Pattern ${full} overlaps ${other} of route "${s.name}" (Asterisk picks the more specific one)`);
      }
    }
    return warnings;
  }

  app.post('/routes', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const body = parse(routeInput, req.body);
    const org = req.auth!.org;
    const warnings = await checkRefs(org, body);
    const { patterns, ...route } = body;
    const created = await withTenant(org, async (tx) => {
      const routeNumber = route.routeNumber ?? ((await tx.route.aggregate({ where: { organizationId: org }, _max: { routeNumber: true } }))._max.routeNumber ?? 0) + 1;
      const r = await tx.route.create({
        data: {
          ...route, routeNumber, organizationId: org,
          patterns: { create: patterns.map((p) => ({ ...p, organizationId: org })) },
        },
        include: { patterns: true },
      });
      await audit(req, { action: 'route.create', objectType: 'route', objectId: r.id, objectLabel: r.name, newValue: body, result: 'SUCCESS' }, tx);
      return r;
    });
    reply.code(201);
    return { ...created, warnings };
  });

  app.put('/routes/:id', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(routeInput, req.body);
    const org = req.auth!.org;
    const existing = await prisma.route.findFirst({ where: { id, organizationId: org }, include: { patterns: true } });
    if (!existing) throw notFound('Route');
    const warnings = (await checkRefs(org, body)).filter((w) => !w.includes(`"${existing.name}"`));
    const { patterns, ...route } = body;
    const updated = await withTenant(org, async (tx) => {
      // Keep pattern IDs stable where pattern text is unchanged (calls reference them).
      const keep = new Map(existing.patterns.map((p) => [`${p.prefix ?? ''}|${p.pattern}`, p]));
      const wanted = new Set(patterns.map((p) => `${p.prefix ?? ''}|${p.pattern}`));
      await tx.routePattern.deleteMany({ where: { routeId: id, id: { in: existing.patterns.filter((p) => !wanted.has(`${p.prefix ?? ''}|${p.pattern}`)).map((p) => p.id) } } });
      for (const p of patterns) {
        const k = keep.get(`${p.prefix ?? ''}|${p.pattern}`);
        if (k) await tx.routePattern.update({ where: { id: k.id }, data: p });
        else await tx.routePattern.create({ data: { ...p, routeId: id, organizationId: org } });
      }
      const r = await tx.route.update({ where: { id }, data: { ...route, routeNumber: route.routeNumber ?? existing.routeNumber }, include: { patterns: true } });
      await audit(req, { action: 'route.update', objectType: 'route', objectId: id, objectLabel: r.name, oldValue: existing, newValue: body, result: 'SUCCESS' }, tx);
      return r;
    });
    return { ...updated, warnings };
  });

  app.delete('/routes/:id', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const org = req.auth!.org;
    const existing = await prisma.route.findFirst({ where: { id, organizationId: org }, include: { patterns: true } });
    if (!existing) throw notFound('Route');
    await withTenant(org, async (tx) => {
      await tx.route.delete({ where: { id } });
      await audit(req, { action: 'route.delete', objectType: 'route', objectId: id, objectLabel: existing.name, oldValue: existing, result: 'SUCCESS' }, tx);
    });
    reply.code(204);
  });

  app.get('/route-patterns', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) =>
    prisma.routePattern.findMany({
      where: { organizationId: req.auth!.org },
      include: { route: { select: { id: true, name: true, routeNumber: true, direction: true, priority: true, pbx: { select: { id: true, name: true, code: true } } } } },
      orderBy: { pattern: 'asc' },
    }));

  /** Dry-run: which route/pattern would Asterisk pick for this number, and what would be dialled. */
  app.post('/route-patterns/test', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) => {
    const body = parse(z.object({ number: z.string().regex(/^[0-9A-Za-z*#+]{1,64}$/), pbxId: z.string().uuid() }), req.body);
    const routes = await prisma.route.findMany({ where: { organizationId: req.auth!.org, pbxId: body.pbxId, enabled: true }, include: { patterns: { where: { enabled: true }, include: { recordingPolicy: true } }, egressTrunk: true, callType: true, recordingPolicy: true, pbx: { include: { recordingPolicy: true } } } });
    const orgDefault = await prisma.recordingPolicy.findFirst({ where: { organizationId: req.auth!.org, isDefault: true } });
    const candidates = routes.flatMap((r) => r.patterns.map((p) => ({
      id: p.id, priority: r.priority, pattern: `${p.prefix ?? ''}${p.pattern.replace(/^_/, '')}`, data: { route: r, pattern: p },
    })));
    const hit = selectRoute(candidates, body.number);
    if (!hit) return { matched: false, number: body.number, considered: candidates.length };
    const { route, pattern } = hit.data!;
    return {
      matched: true,
      number: body.number,
      route: { id: route.id, name: route.name, routeNumber: route.routeNumber, direction: route.direction, priority: route.priority },
      pattern: { id: pattern.id, pattern: hit.pattern },
      dialled: transformNumber(body.number, (pattern.prefix ?? '').length + pattern.stripDigits, pattern.prepend ?? ''),
      egress: route.egressKind === 'TRUNK' ? { kind: 'TRUNK', trunk: route.egressTrunk?.name } : { kind: route.egressKind, context: route.egressContext },
      prefix: pattern.prefix ?? '',
      stripDigits: (pattern.prefix ?? '').length + pattern.stripDigits,
      prepend: pattern.prepend ?? '',
      callType: route.callType ? { code: route.callType.code, name: route.callType.name } : null,
      // Same precedence as the dialplan compiler: pattern → route → PBX → organisation default.
      recordingPolicy: (() => {
        const p = pattern.recordingPolicy ?? route.recordingPolicy ?? route.pbx.recordingPolicy ?? orgDefault;
        return p ? { name: p.name, mode: p.mode, layout: p.layout, format: p.format } : { name: 'Built-in default', mode: 'ALWAYS', layout: 'MIXED', format: 'wav' };
      })(),
    };
  });

  /** Route-pattern statistics (spec §37). */
  app.get('/route-patterns/:id/stats', { preHandler: app.requirePermission(P.REPORTS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    const org = req.auth!.org;
    const pattern = await prisma.routePattern.findFirst({ where: { id, organizationId: org }, include: { route: true } });
    if (!pattern) throw notFound('Route pattern');
    const from = q.from ?? new Date(Date.now() - 30 * 86_400_000);
    const to = q.to ?? new Date();
    const [row] = await prisma.$queryRaw<Array<Record<string, bigint | number | null>>>(Prisma.sql`
      SELECT count(*)::bigint                                             AS total,
             count(*) FILTER (WHERE direction = 'INBOUND')::bigint         AS inbound,
             count(*) FILTER (WHERE direction = 'OUTBOUND')::bigint        AS outbound,
             count(*) FILTER (WHERE answer_status = 'ANSWERED')::bigint    AS answered,
             count(*) FILTER (WHERE answer_status IN ('FAILED','CONGESTION'))::bigint AS failed,
             coalesce(sum(billsec),0)::bigint                              AS total_billsec,
             coalesce(avg(billsec) FILTER (WHERE answer_status = 'ANSWERED'),0)::float AS avg_billsec,
             count(*) FILTER (WHERE has_recording)::bigint                 AS recordings
      FROM app.calls
      WHERE organization_id = ${org}::uuid AND route_pattern_id = ${id}::uuid
        AND start_time >= ${from} AND start_time < ${to}`);
    const n = (v: unknown) => Number(v ?? 0);
    return {
      pattern: { id: pattern.id, pattern: `${pattern.prefix ?? ''}${pattern.pattern}`, route: pattern.route.name },
      from, to,
      totalCalls: n(row?.['total']), inbound: n(row?.['inbound']), outbound: n(row?.['outbound']),
      answered: n(row?.['answered']), failed: n(row?.['failed']),
      totalDurationSec: n(row?.['total_billsec']), averageDurationSec: Math.round(n(row?.['avg_billsec'])),
      recordings: n(row?.['recordings']),
    };
  });

  // ---------------- Call types & classification rules ----------------
  app.get('/call-types', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) =>
    prisma.callType.findMany({ where: { organizationId: req.auth!.org }, orderBy: { name: 'asc' } }));

  app.post('/call-types', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const body = parse(z.object({ code: z.string().regex(/^[A-Z0-9_]{1,48}$/), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish() }), req.body);
    const org = req.auth!.org;
    const ct = await withTenant(org, async (tx) => {
      const c = await tx.callType.create({ data: { ...body, organizationId: org } });
      await audit(req, { action: 'call_type.create', objectType: 'call_type', objectId: c.id, objectLabel: c.code, newValue: body, result: 'SUCCESS' }, tx);
      return c;
    });
    reply.code(201);
    return ct;
  });

  app.get('/classification-rules', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) =>
    prisma.classificationRule.findMany({ where: { organizationId: req.auth!.org }, orderBy: { priority: 'asc' } }));

  const ruleBody = ruleSchema.omit({ id: true });
  app.post('/classification-rules', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const body = parse(ruleBody, req.body);
    const org = req.auth!.org;
    if (body.actions.callTypeCode && !(await prisma.callType.findFirst({ where: { organizationId: org, code: body.actions.callTypeCode } }))) {
      throw new AppError('VALIDATION_FAILED', `Call type ${body.actions.callTypeCode} does not exist`);
    }
    const rule = await withTenant(org, async (tx) => {
      const r = await tx.classificationRule.create({ data: { organizationId: org, name: body.name, priority: body.priority, enabled: body.enabled, match: body.match, conditions: body.conditions as Prisma.InputJsonValue, actions: body.actions as Prisma.InputJsonValue, stop: body.stop } });
      await audit(req, { action: 'classification_rule.create', objectType: 'classification_rule', objectId: r.id, objectLabel: r.name, newValue: body, result: 'SUCCESS' }, tx);
      return r;
    });
    reply.code(201);
    return rule;
  });

  app.put('/classification-rules/:id', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(ruleBody, req.body);
    const org = req.auth!.org;
    const existing = await prisma.classificationRule.findFirst({ where: { id, organizationId: org } });
    if (!existing) throw notFound('Classification rule');
    if (body.actions.callTypeCode && !(await prisma.callType.findFirst({ where: { organizationId: org, code: body.actions.callTypeCode } }))) {
      throw new AppError('VALIDATION_FAILED', `Call type ${body.actions.callTypeCode} does not exist`);
    }
    const r = await prisma.classificationRule.update({ where: { id }, data: { name: body.name, priority: body.priority, enabled: body.enabled, match: body.match, conditions: body.conditions as Prisma.InputJsonValue, actions: body.actions as Prisma.InputJsonValue, stop: body.stop } });
    await audit(req, { action: 'classification_rule.update', objectType: 'classification_rule', objectId: id, objectLabel: r.name, oldValue: existing, newValue: body, result: 'SUCCESS' });
    return r;
  });

  app.delete('/classification-rules/:id', { preHandler: app.requirePermission(P.ROUTES_CONFIGURE) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const existing = await prisma.classificationRule.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('Classification rule');
    await prisma.classificationRule.delete({ where: { id } });
    await audit(req, { action: 'classification_rule.delete', objectType: 'classification_rule', objectId: id, objectLabel: existing.name, oldValue: existing, result: 'SUCCESS' });
    reply.code(204);
  });

  /** Evaluate the current rule set against a sample call without saving anything. */
  app.post('/classification-rules/test', { preHandler: app.requirePermission(P.ROUTES_VIEW) }, async (req) => {
    const ctx = parse(z.object({
      direction: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT', 'UNKNOWN']).default('UNKNOWN'),
      sourcePbxId: z.string().nullish(), destinationPbxId: z.string().nullish(), trunkId: z.string().nullish(), routeId: z.string().nullish(),
      context: z.string().nullish(), callerNumber: z.string().max(64).nullish(), destinationNumber: z.string().max(64).nullish(),
      callerIsExtension: z.boolean().optional(), destinationIsExtension: z.boolean().optional(),
      disposition: z.string().max(20).nullish(), billsec: z.number().int().optional(), duration: z.number().int().optional(),
      sipHeaders: z.record(z.string().max(512)).optional(),
    }), req.body);
    const rows = await prisma.classificationRule.findMany({ where: { organizationId: req.auth!.org, enabled: true } });
    const rules = rows.map((r) => ruleSchema.parse({ ...r, conditions: r.conditions, actions: r.actions })) as ClassificationRule[];
    return new ClassificationEngine(rules).classify(ctx);
  });
}
