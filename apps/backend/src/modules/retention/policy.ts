/**
 * Retention policy resolution & safe cleanup (docs/07 §6, spec §33-34).
 * When several policies match, the LONGEST retention wins (null = unlimited).
 */
import type { Prisma, RecordingLayout } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { driverFor } from '../storage/drivers.js';

export interface RetentionSubject {
  startedAt: Date;
  pbxId: string | null;
  callTypeId: string | null;
  routeId: string | null;
  department: string | null;
  layout: RecordingLayout;
}

interface PolicyLike {
  keepDays: number | null;
  pbxId: string | null;
  callTypeId: string | null;
  routeId: string | null;
  department: string | null;
  layout: RecordingLayout | null;
}

export function policyMatches(p: PolicyLike, s: RetentionSubject): boolean {
  return (!p.pbxId || p.pbxId === s.pbxId)
    && (!p.callTypeId || p.callTypeId === s.callTypeId)
    && (!p.routeId || p.routeId === s.routeId)
    && (!p.department || p.department === s.department)
    && (!p.layout || p.layout === s.layout);
}

/** Returns expiry date, or null for unlimited / no matching policy. */
export function resolveExpiry(policies: PolicyLike[], s: RetentionSubject): Date | null {
  const matching = policies.filter((p) => policyMatches(p, s));
  if (!matching.length) return null; // no policy → keep (safe default)
  if (matching.some((p) => p.keepDays === null)) return null;
  const days = Math.max(...matching.map((p) => p.keepDays!));
  return new Date(s.startedAt.getTime() + days * 86_400_000);
}

export async function computeRetentionExpiry(tx: Tx, organizationId: string, s: RetentionSubject): Promise<Date | null> {
  const policies = await tx.retentionPolicy.findMany({ where: { organizationId, enabled: true } });
  return resolveExpiry(policies, s);
}

export interface RetentionRunOptions {
  organizationId: string;
  dryRun: boolean;
  startedBy?: string;
  maxBatches?: number;
}

/** Minimal logger contract satisfied by pino and Fastify's request logger. */
export interface Log { error(obj: object, msg?: string): void; info(obj: object, msg?: string): void }

export async function runRetention(opts: RetentionRunOptions, log: Log) {
  const run = await prisma.retentionRun.create({ data: { organizationId: opts.organizationId, dryRun: opts.dryRun, startedBy: opts.startedBy } });
  const policies = await prisma.retentionPolicy.findMany({ where: { organizationId: opts.organizationId, enabled: true } });
  const report: Array<{ recordingId: string; baseName: string; action: string; detail?: string }> = [];
  let examined = 0, deleted = 0, missing = 0, errors = 0;
  let bytesFreed = 0n;
  let cursor: string | undefined;

  for (let batch = 0; batch < (opts.maxBatches ?? 100); batch++) {
    const recs = await prisma.recording.findMany({
      where: { organizationId: opts.organizationId, legalHold: false, state: { in: ['AVAILABLE', 'ARCHIVED', 'MISSING_FILE'] }, retentionExpiresAt: { lt: new Date() } },
      include: { storageLocation: true, call: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!recs.length) break;
    cursor = recs[recs.length - 1]!.id;

    for (const r of recs) {
      examined++;
      // 1. Re-verify the policy now (it may have changed since the expiry was computed).
      const expiry = resolveExpiry(policies, {
        startedAt: r.startedAt, pbxId: r.call?.sourcePbxId ?? null, callTypeId: r.call?.callTypeId ?? null,
        routeId: r.call?.routeId ?? null, department: r.call?.department ?? null, layout: r.layout,
      });
      if (!expiry || expiry > new Date()) {
        if (!opts.dryRun) await prisma.recording.update({ where: { id: r.id }, data: { retentionExpiresAt: expiry } });
        report.push({ recordingId: r.id, baseName: r.baseName, action: 'KEEP', detail: 'policy changed' });
        continue;
      }
      // 2. Verify the files exist.
      const driver = driverFor(r.storageLocation);
      const files = Object.values(r.files as Record<string, string>).filter(Boolean);
      const stats = await Promise.all(files.map((f) => driver.stat(f)));
      if (stats.every((s) => !s.exists)) {
        missing++;
        report.push({ recordingId: r.id, baseName: r.baseName, action: 'MISSING', detail: 'no files on storage; left for review' });
        if (!opts.dryRun) await prisma.recording.update({ where: { id: r.id }, data: { state: 'MISSING_FILE' } });
        continue;
      }
      if (opts.dryRun) {
        report.push({ recordingId: r.id, baseName: r.baseName, action: 'WOULD_DELETE' });
        continue;
      }
      // 3. Delete files; 4. only then delete metadata, with an audit row.
      try {
        let freed = 0;
        for (let i = 0; i < files.length; i++) {
          if (stats[i]!.exists) { await driver.delete(files[i]!); freed += stats[i]!.size; }
        }
        await prisma.$transaction(async (tx) => {
          await tx.recording.delete({ where: { id: r.id } });
          if (r.callId) {
            const left = await tx.recording.count({ where: { callId: r.callId } });
            if (!left) await tx.call.update({ where: { id: r.callId }, data: { hasRecording: false } });
          }
          await tx.auditLog.create({
            data: {
              organizationId: opts.organizationId, userId: opts.startedBy ?? null, action: 'retention.delete', objectType: 'recording',
              objectId: r.id, objectLabel: r.baseName, oldValue: { files, expiresAt: r.retentionExpiresAt } as Prisma.InputJsonValue, result: 'SUCCESS',
            },
          });
        });
        deleted++;
        bytesFreed += BigInt(freed);
        report.push({ recordingId: r.id, baseName: r.baseName, action: 'DELETED' });
      } catch (e) {
        errors++;
        report.push({ recordingId: r.id, baseName: r.baseName, action: 'ERROR', detail: (e as Error).message });
        log.error({ recordingId: r.id, err: (e as Error).message }, 'retention delete failed');
      }
    }
  }

  return prisma.retentionRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), examined, deleted, missing, errors, bytesFreed, report: report.slice(0, 5000) as Prisma.InputJsonValue },
  });
}
