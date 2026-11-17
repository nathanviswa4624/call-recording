/**
 * Background worker process (echelons-worker.service).
 * BullMQ repeatable jobs: CDR ingestion, recording verification, nightly retention.
 */
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { env } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { ingestServerCdrs, verifyClosedRecordings } from './modules/cdr/ingest.js';
import { runRetention } from './modules/retention/policy.js';

const log = pino({ ...loggerOptions(env().LOG_LEVEL), base: { service: 'echelons-worker' } });
const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
const QUEUE = 'echelons-maintenance';

async function main() {
  const queue = new Queue(QUEUE, { connection });
  await queue.upsertJobScheduler('cdr-ingest', { every: 5_000 }, { name: 'cdr-ingest' });
  await queue.upsertJobScheduler('recording-verify', { every: 60_000 }, { name: 'recording-verify' });
  await queue.upsertJobScheduler('retention-nightly', { pattern: '30 2 * * *' }, { name: 'retention' });

  const worker = new Worker(QUEUE, async (job) => {
    const servers = await prisma.asteriskServer.findMany({ select: { id: true, organizationId: true } });
    switch (job.name) {
      case 'cdr-ingest':
        for (const s of servers) {
          // Drain backlog quickly, bounded per tick.
          for (let i = 0; i < 20; i++) {
            const n = await ingestServerCdrs(s.id, log).catch((e: Error) => { log.error({ serverId: s.id, err: e.message }, 'cdr ingest failed'); return 0; });
            if (n < 500) break;
          }
        }
        break;
      case 'recording-verify':
        for (const s of servers) await verifyClosedRecordings(s.id, log).catch((e: Error) => log.error({ serverId: s.id, err: e.message }, 'recording verify failed'));
        break;
      case 'retention': {
        const orgs = [...new Set(servers.map((s) => s.organizationId))];
        for (const organizationId of orgs) {
          const run = await runRetention({ organizationId, dryRun: false }, log);
          log.info({ organizationId, examined: run.examined, deleted: run.deleted, missing: run.missing, errors: run.errors }, 'retention run complete');
        }
        break;
      }
    }
  }, { connection, concurrency: 1 });

  worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));
  const stop = async () => { await worker.close(); await queue.close(); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  log.info('worker started');
}

main().catch((e) => { log.fatal({ err: (e as Error).message }, 'worker failed to start'); process.exit(1); });
