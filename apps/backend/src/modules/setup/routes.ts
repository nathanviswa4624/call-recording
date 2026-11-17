/**
 * First-run installation wizard API (spec §46). Every endpoint refuses to run
 * once an organization exists, so it cannot be used to take over an installed system.
 */
import type { FastifyInstance } from 'fastify';
import { promises as fs, constants } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, parse } from '../../lib/errors.js';
import { SecretBox } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { ConnectorClient } from '../connector/client.js';
import { hashPassword, validatePasswordPolicy } from '../auth/service.js';
import { seedGlobal, seedOrganization } from '../../../prisma/seed.js';
import { audit } from '../audit/service.js';

async function assertNotInstalled() {
  if ((await prisma.organization.count()) > 0) throw new AppError('FORBIDDEN', 'Setup has already been completed');
}

export async function setupRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/setup/status', async () => ({ installed: (await prisma.organization.count()) > 0 }));

  /** Step 8 — test every dependency before finishing. */
  app.post('/setup/test', limited, async () => {
    await assertNotInstalled();
    const e = env();
    const result: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      const [v] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
      result['postgresql'] = { ok: true, detail: v?.version.split(',')[0] };
    } catch (err) {
      result['postgresql'] = { ok: false, detail: (err as Error).message };
    }
    try {
      const [t] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'asterisk' AND table_name IN ('ps_endpoints','cdr')`;
      result['realtime_schema'] = { ok: (t?.n ?? 0) === 2, detail: (t?.n ?? 0) === 2 ? 'asterisk.ps_* and cdr present' : 'run deploy/asterisk/sql/asterisk_realtime.sql' };
    } catch (err) {
      result['realtime_schema'] = { ok: false, detail: (err as Error).message };
    }
    const connector = new ConnectorClient(e.CONNECTOR_URL, e.CONNECTOR_TOKEN, 5000);
    try {
      const h = await connector.health();
      result['asterisk'] = { ok: Boolean(h.version), detail: h.version?.raw ?? 'version unknown' };
      result['ami'] = { ok: h.ami, detail: h.ami ? 'connected' : 'not connected — check manager.conf and connector.env' };
      result['ari'] = { ok: h.ari, detail: h.ari ? 'reachable' : 'not reachable (optional, used for diagnostics)' };
    } catch (err) {
      result['connector'] = { ok: false, detail: (err as Error).message };
    }
    try {
      await fs.access(e.RECORDING_BASE_PATH, constants.R_OK);
      const st = await fs.statfs(e.RECORDING_BASE_PATH);
      result['recording_directory'] = { ok: true, detail: `${e.RECORDING_BASE_PATH} — ${(st.bavail * st.bsize / 1e9).toFixed(1)} GB free` };
    } catch (err) {
      result['recording_directory'] = { ok: false, detail: `${e.RECORDING_BASE_PATH}: ${(err as Error).message}` };
    }
    return result;
  });

  /** Steps 1–9 in one atomic call: organization, site, Asterisk server, storage, administrator. */
  app.post('/setup/complete', limited, async (req) => {
    await assertNotInstalled();
    const b = parse(z.object({
      organization: z.object({ name: z.string().min(1).max(120), slug: z.string().regex(/^[a-z0-9-]{2,64}$/) }),
      site: z.object({ name: z.string().min(1).max(120), code: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), timezone: z.string().max(64).default('UTC') }),
      server: z.object({ name: z.string().min(1).max(80).default('asterisk-1'), recordingBasePath: z.string().regex(/^\/[A-Za-z0-9_.\/\-]+$/).optional() }),
      admin: z.object({ username: z.string().regex(/^[A-Za-z0-9._-]{3,64}$/), email: z.string().email(), displayName: z.string().min(1).max(120), password: z.string().max(256) }),
    }), req.body);
    const policy = validatePasswordPolicy(b.admin.password);
    if (policy) throw new AppError('VALIDATION_FAILED', policy);
    const e = env();
    const passwordHash = await hashPassword(b.admin.password);
    const box = new SecretBox(e.ENCRYPTION_KEY);

    const created = await prisma.$transaction(async (tx) => {
      if ((await tx.organization.count()) > 0) throw new AppError('FORBIDDEN', 'Setup has already been completed');
      await seedGlobal(tx);
      const org = await tx.organization.create({ data: { name: b.organization.name, slug: b.organization.slug } });
      await seedOrganization(tx, org.id);
      const site = await tx.site.create({ data: { organizationId: org.id, name: b.site.name, code: b.site.code, timezone: b.site.timezone } });
      const basePath = b.server.recordingBasePath ?? e.RECORDING_BASE_PATH;
      const server = await tx.asteriskServer.create({ data: { organizationId: org.id, siteId: site.id, name: b.server.name, connectorUrl: e.CONNECTOR_URL, connectorTokenEnc: 'pending', recordingBasePath: basePath } });
      await tx.asteriskServer.update({ where: { id: server.id }, data: { connectorTokenEnc: box.encrypt(e.CONNECTOR_TOKEN, `server:${server.id}`) } });
      await tx.storageLocation.create({ data: { organizationId: org.id, name: 'Local recordings', kind: 'LOCAL', basePath, isDefault: true } });
      const superAdmin = await tx.role.findFirstOrThrow({ where: { organizationId: null, code: 'SUPER_ADMIN' } });
      const admin = await tx.user.create({
        data: {
          organizationId: org.id, username: b.admin.username, email: b.admin.email.toLowerCase(), displayName: b.admin.displayName, passwordHash,
          roles: { create: [{ roleId: superAdmin.id }] },
        },
      });
      return { org, site, server, admin };
    }, { timeout: 60_000 });

    await audit(null, { action: 'setup.complete', objectType: 'organization', objectId: created.org.id, objectLabel: created.org.name, newValue: { site: b.site, server: b.server.name, admin: b.admin.username }, result: 'SUCCESS' }, undefined, created.org.id);
    return { organizationId: created.org.id, siteId: created.site.id, serverId: created.server.id, adminUserId: created.admin.id };
  });
}
