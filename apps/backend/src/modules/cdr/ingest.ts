/**
 * CDR ingestion worker (docs/04 §6).
 *
 * Reads <realtime_schema>.cdr (written by cdr_adaptive_odbc) by `seq` watermark,
 * normalises rows into app.cdr_records / app.calls (grouped by linkedid),
 * classifies the call and links its recording. Idempotent: (server_id, source_seq)
 * is unique and the watermark only advances after a committed batch.
 */
import { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import {
  ClassificationEngine, dispositionToStatus, ruleSchema, type CallDirection, type ClassificationRule,
} from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { LocalDriver } from '../storage/drivers.js';
import { connectorFor } from '../connector/client.js';
import { computeRetentionExpiry } from '../retention/policy.js';

const BATCH = 500;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

interface CdrRow {
  seq: bigint;
  calldate: Date;
  answerdate: Date | null;
  enddate: Date | null;
  clid: string | null;
  src: string | null;
  dst: string | null;
  dcontext: string | null;
  channel: string | null;
  dstchannel: string | null;
  lastapp: string | null;
  lastdata: string | null;
  duration: number;
  billsec: number;
  disposition: string;
  amaflags: number | null;
  accountcode: string | null;
  uniqueid: string;
  userfield: string | null;
  peeraccount: string | null;
  linkedid: string;
  sequence: number | null;
  ech_pbx_id: string | null;
  ech_trunk_id: string | null;
  ech_route_id: string | null;
  ech_route_pattern_id: string | null;
  ech_direction: string | null;
  ech_dialed: string | null;
  ech_rec_file: string | null;
  ech_rec_format: string | null;
  ech_rec_policy: string | null;
  sip_callid: string | null;
  peer_ip: string | null;
  user_agent: string | null;
  hangupcause: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);

function parseClid(clid: string | null): { name: string | null; num: string | null } {
  if (!clid) return { name: null, num: null };
  const m = /^"?([^"<]*)"?\s*<([^>]*)>$/.exec(clid.trim());
  return m ? { name: m[1]!.trim() || null, num: m[2]!.trim() || null } : { name: null, num: clid };
}

const DIRECTIONS = new Set(['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT']);

export async function ingestServerCdrs(serverId: string, log: Logger): Promise<number> {
  const server = await prisma.asteriskServer.findUniqueOrThrow({ where: { id: serverId } });
  if (!SCHEMA_RE.test(server.realtimeSchema)) throw new Error('invalid realtime schema');
  const schema = Prisma.raw(`"${server.realtimeSchema}"`);
  const rows = await prisma.$queryRaw<CdrRow[]>`
    SELECT * FROM ${schema}.cdr WHERE seq > ${server.cdrWatermark} ORDER BY seq ASC LIMIT ${BATCH}`;
  if (!rows.length) return 0;

  const ruleRows = await prisma.classificationRule.findMany({ where: { organizationId: server.organizationId, enabled: true } });
  const rules: ClassificationRule[] = [];
  for (const r of ruleRows) {
    const parsed = ruleSchema.safeParse({ ...r, conditions: r.conditions, actions: r.actions });
    if (parsed.success) rules.push(parsed.data);
    else log.warn({ ruleId: r.id }, 'skipping invalid classification rule');
  }
  const engine = new ClassificationEngine(rules);
  const callTypes = new Map((await prisma.callType.findMany({ where: { organizationId: server.organizationId } })).map((c) => [c.code, c.id]));
  // Route-level call type (set in the route editor) applies when no rule assigned a type.
  const routeCallType = new Map((await prisma.route.findMany({ where: { organizationId: server.organizationId, callTypeId: { not: null } }, select: { id: true, callTypeId: true } })).map((r) => [r.id, r.callTypeId!]));
  const pbxs = await prisma.pbx.findMany({ where: { serverId }, select: { id: true, siteId: true, directory: true } });
  const pbxById = new Map(pbxs.map((p) => [p.id, p]));
  const storage = await ensureServerStorage(server.organizationId, server.recordingBasePath);

  const byLinked = new Map<string, CdrRow[]>();
  for (const r of rows) {
    const list = byLinked.get(r.linkedid) ?? [];
    list.push(r);
    byLinked.set(r.linkedid, list);
  }

  for (const [linkedid, group] of byLinked) {
    // Merge with CDRs of this call already ingested in earlier batches.
    const prior = await prisma.cdrRecord.findMany({ where: { serverId, linkedid } });
    const pick = <K extends keyof CdrRow>(k: K): CdrRow[K] | null => {
      for (const r of group) if (r[k] !== null && r[k] !== undefined && r[k] !== '') return r[k];
      for (const p of prior) {
        const v = (p.extra as Record<string, unknown>)[k as string];
        if (v !== null && v !== undefined && v !== '') return v as CdrRow[K];
      }
      return null;
    };
    const all = [...prior.map((p) => ({ calldate: p.calldate, answerdate: p.answerdate, enddate: p.enddate, billsec: p.billsec, duration: p.duration, disposition: p.disposition, src: p.src, dst: p.dst, clid: p.clid, uniqueid: p.uniqueid, dcontext: p.dcontext })), ...group];
    const first = all.reduce((a, b) => (b.calldate < a.calldate ? b : a));
    const start = first.calldate;
    const answer = all.map((r) => r.answerdate).filter((d): d is Date => Boolean(d) && d!.getTime() > 0).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const end = all.map((r) => r.enddate).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const anyAnswered = all.some((r) => r.disposition === 'ANSWERED');
    const disposition = anyAnswered ? 'ANSWERED' : (group[group.length - 1]?.disposition ?? first.disposition);
    const billsec = Math.max(...all.map((r) => r.billsec));
    const duration = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : Math.max(...all.map((r) => r.duration));
    const clid = parseClid(first.clid);
    const callerNumber = clid.num ?? first.src;
    const dialed = pick('ech_dialed');
    const destination = dialed ?? first.dst;

    const pbxId = uuidOrNull(pick('ech_pbx_id'));
    const pbx = pbxId ? pbxById.get(pbxId) : undefined;
    const dirRaw = pick('ech_direction');
    const direction: CallDirection = dirRaw && DIRECTIONS.has(dirRaw) ? (dirRaw as CallDirection) : 'UNKNOWN';
    const dirEntry = (n: string | null) => (n && pbx ? pbx.directory.find((d) => d.extension === n) : undefined);
    const callerExt = dirEntry(callerNumber);
    const destExt = dirEntry(destination);

    const result = engine.classify({
      direction,
      sourcePbxId: pbxId,
      trunkId: uuidOrNull(pick('ech_trunk_id')),
      routeId: uuidOrNull(pick('ech_route_id')),
      context: first.dcontext,
      callerNumber,
      destinationNumber: destination,
      callerIsExtension: Boolean(callerExt) || Boolean(callerNumber && /^\d{2,5}$/.test(callerNumber)),
      destinationIsExtension: Boolean(destExt) || Boolean(destination && /^\d{2,5}$/.test(destination)),
      disposition,
      billsec,
      duration,
      sipHeaders: pick('user_agent') ? { 'User-Agent': String(pick('user_agent')) } : undefined,
    });
    const agent = callerExt ?? destExt;
    // Precedence: classification rule > route's configured call type > direction/status default.
    const finalRouteId = uuidOrNull(result.routeId ?? null);
    const callTypeId = result.callTypeSource === 'rule'
      ? callTypes.get(result.callTypeCode) ?? null
      : (finalRouteId && routeCallType.get(finalRouteId)) ?? callTypes.get(result.callTypeCode) ?? null;

    await prisma.$transaction(async (tx) => {
      const call = await tx.call.upsert({
        where: { serverId_linkedid: { serverId, linkedid } },
        create: {
          organizationId: server.organizationId, siteId: pbx?.siteId ?? server.siteId, serverId, linkedid, uniqueid: first.uniqueid,
          sipCallId: pick('sip_callid'), sourcePbxId: pbxId, trunkId: uuidOrNull(pick('ech_trunk_id')),
          routeId: finalRouteId, routePatternId: uuidOrNull(pick('ech_route_pattern_id')),
          callTypeId, direction: result.direction,
          callerNumber, callerName: clid.name, destinationNumber: destination, dialedNumber: dialed,
          extension: agent?.extension ?? null, agentUserId: agent?.agentUserId ?? null, department: agent?.department ?? null, queue: agent?.queue ?? null,
          campaign: pick('accountcode') ? String(pick('accountcode')) : null,
          context: first.dcontext, startTime: start, answerTime: answer, endTime: end, duration, billsec,
          answerStatus: result.answerStatus, hangupCause: pick('hangupcause'), sourceIp: pick('peer_ip'), userAgent: pick('user_agent'),
          tags: result.tags, classifiedBy: result.matchedRuleIds,
        },
        update: {
          answerTime: answer, endTime: end, duration, billsec, answerStatus: result.answerStatus,
          callTypeId, direction: result.direction,
          routeId: finalRouteId, tags: result.tags, classifiedBy: result.matchedRuleIds,
        },
      });

      for (const r of group) {
        const { seq, calldate, answerdate, enddate, duration: d, billsec: b, disposition: disp, channel, dstchannel, src, dst, clid: c, dcontext, lastapp, lastdata, accountcode, amaflags, userfield, peeraccount, sequence, uniqueid, linkedid: l, ...extra } = r;
        await tx.cdrRecord.upsert({
          where: { serverId_sourceSeq: { serverId, sourceSeq: seq } },
          update: {},
          create: {
            organizationId: server.organizationId, serverId, callId: call.id, sourceSeq: seq, uniqueid, linkedid: l,
            calldate, answerdate: answerdate && answerdate.getTime() > 0 ? answerdate : null, enddate, duration: d, billsec: b, disposition: disp,
            channel, dstchannel, src, dst, clid: c, dcontext, lastapp, lastdata, accountcode, amaflags, userfield, peeraccount, sequence,
            extra: extra as Prisma.InputJsonValue,
          },
        });
      }

      const recBase = pick('ech_rec_file');
      if (recBase && !/(^|\/)\.\.(\/|$)/.test(recBase)) {
        const fmt = (pick('ech_rec_format') ?? 'wav').replace(/[^a-z0-9]/g, '') || 'wav';
        const split = String(pick('ech_rec_policy') ?? '').includes('MIXED_AND_SPLIT');
        const files: Record<string, string> = { mixed: `${recBase}.${fmt}` };
        if (split) { files['caller'] = `${recBase}-caller.${fmt}`; files['callee'] = `${recBase}-callee.${fmt}`; }
        const expiry = await computeRetentionExpiry(tx, server.organizationId, { startedAt: start, pbxId, callTypeId, routeId: call.routeId, department: call.department, layout: split ? 'MIXED_AND_SPLIT' : 'MIXED' });
        await tx.recording.upsert({
          where: { storageLocationId_baseName: { storageLocationId: storage.id, baseName: recBase } },
          update: { callId: call.id, endedAt: end },
          create: {
            organizationId: server.organizationId, siteId: call.siteId, callId: call.id, storageLocationId: storage.id,
            baseName: recBase, format: fmt, layout: split ? 'MIXED_AND_SPLIT' : 'MIXED', files, state: 'CLOSED',
            startedAt: answer ?? start, endedAt: end, durationSec: billsec, retentionExpiresAt: expiry,
          },
        });
        await tx.call.update({ where: { id: call.id }, data: { hasRecording: true } });
      }
    }, { timeout: 30_000 });
  }

  const maxSeq = rows[rows.length - 1]!.seq;
  await prisma.asteriskServer.update({ where: { id: serverId }, data: { cdrWatermark: maxSeq } });
  log.info({ serverId, rows: rows.length, calls: byLinked.size, watermark: maxSeq.toString() }, 'cdr batch ingested');
  return rows.length;
}

/** Recording storage location that matches the server's MixMonitor base path. */
async function ensureServerStorage(organizationId: string, basePath: string) {
  const existing = await prisma.storageLocation.findFirst({ where: { organizationId, kind: 'LOCAL', basePath } });
  if (existing) return existing;
  return prisma.storageLocation.create({ data: { organizationId, name: `Local ${basePath}`, kind: 'LOCAL', basePath, isDefault: false } });
}

/**
 * Verify CLOSED recordings exist on disk; mark AVAILABLE (with size) or MISSING_FILE
 * after a grace period (MixMonitor closes the file shortly after hangup).
 */
export async function verifyClosedRecordings(serverId: string, log: Logger): Promise<void> {
  const server = await prisma.asteriskServer.findUniqueOrThrow({ where: { id: serverId } });
  const recs = await prisma.recording.findMany({
    where: { state: 'CLOSED', storageLocation: { kind: 'LOCAL', basePath: server.recordingBasePath }, organizationId: server.organizationId },
    take: 200,
    orderBy: { createdAt: 'asc' },
  });
  if (!recs.length) return;
  const local = new LocalDriver(server.recordingBasePath);
  const connector = await connectorFor(serverId).catch(() => null);
  for (const r of recs) {
    const files = r.files as Record<string, string>;
    let size = 0;
    let missing = false;
    for (const rel of Object.values(files)) {
      let st = await local.stat(rel);
      if (!st.exists && connector) {
        const remote = await connector.recordingStat(rel).catch(() => null);
        if (remote?.exists) st = { exists: true, size: remote.size, mtime: remote.mtime ? new Date(remote.mtime) : null };
      }
      if (st.exists) size += st.size;
      else missing = true;
    }
    if (!missing) {
      await prisma.recording.update({ where: { id: r.id }, data: { state: 'AVAILABLE', sizeBytes: BigInt(size) } });
    } else if (Date.now() - r.createdAt.getTime() > 10 * 60_000) {
      await prisma.recording.update({ where: { id: r.id }, data: { state: 'MISSING_FILE' } });
      log.warn({ recordingId: r.id, baseName: r.baseName }, 'recording file missing after grace period');
    }
  }
}

export { dispositionToStatus };
