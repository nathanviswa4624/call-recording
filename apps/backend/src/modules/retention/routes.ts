import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISSIONS as P } from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { notFound, parse } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import { runRetention } from './policy.js';

const policyInput = z.object({
  name: z.string().min(1).max(80),
  keepDays: z.number().int().min(1).max(36500).nullable(),
  pbxId: z.string().uuid().nullish(),
  callTypeId: z.string().uuid().nullish(),
  routeId: z.string().uuid().nullish(),
  department: z.string().max(80).nullish(),
  layout: z.enum(['MIXED', 'MIXED_AND_SPLIT']).nullish(),
  storageLocationId: z.string().uuid().nullish(),
  enabled: z.boolean().default(true),
});

export async function retentionRoutes(app: FastifyInstance) {
  const guard = { preHandler: app.requirePermission(P.SYSTEM_MANAGE) };

  app.get('/retention', guard, async (req) => prisma.retentionPolicy.findMany({ where: { organizationId: req.auth!.org }, orderBy: { name: 'asc' } }));

  app.post('/retention', guard, async (req, reply) => {
    const b = parse(policyInput, req.body);
    const p = await prisma.retentionPolicy.create({ data: { ...b, organizationId: req.auth!.org } });
    await audit(req, { action: 'retention.policy.create', objectType: 'retention_policy', objectId: p.id, objectLabel: p.name, newValue: b, result: 'SUCCESS' });
    reply.code(201);
    return p;
  });

  app.put('/retention/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = parse(policyInput, req.body);
    const existing = await prisma.retentionPolicy.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!existing) throw notFound('Retention policy');
    const p = await prisma.retentionPolicy.update({ where: { id }, data: b });
    await audit(req, { action: 'retention.policy.update', objectType: 'retention_policy', objectId: id, objectLabel: p.name, oldValue: existing, newValue: b, result: 'SUCCESS' });
    return p;
  });

  /** Run cleanup now. dryRun defaults to TRUE — deleting requires an explicit false. */
  app.post('/retention/run', { ...guard, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ dryRun: z.boolean().default(true) }), req.body ?? {});
    const run = await runRetention({ organizationId: req.auth!.org, dryRun: b.dryRun, startedBy: req.auth!.sub, maxBatches: 20 }, req.log);
    await audit(req, { action: b.dryRun ? 'retention.dry_run' : 'retention.run', objectType: 'retention_run', objectId: run.id, newValue: { examined: run.examined, deleted: run.deleted, missing: run.missing, errors: run.errors }, result: 'SUCCESS' });
    return { ...run, bytesFreed: Number(run.bytesFreed) };
  });

  app.get('/retention/runs/:id', guard, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const run = await prisma.retentionRun.findFirst({ where: { id, organizationId: req.auth!.org } });
    if (!run) throw notFound('Retention run');
    return { ...run, bytesFreed: Number(run.bytesFreed) };
  });
}
