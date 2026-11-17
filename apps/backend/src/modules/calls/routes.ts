import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PERMISSIONS as P } from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { notFound, parse } from '../../lib/errors.js';
import { buildCallWhere, callFilterSchema, encodeCursor } from './search.js';

const idParam = z.object({ id: z.string().uuid() });

export async function callRoutes(app: FastifyInstance) {
  app.get('/calls', { preHandler: app.requirePermission(P.CALLS_VIEW) }, async (req) => {
    const f = parse(callFilterSchema, req.query);
    const where = buildCallWhere(f, req.auth!);
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT c.id, c.start_time, c.answer_time, c.end_time, c.caller_number, c.caller_name, c.destination_number,
             c.dialed_number, c.direction, c.answer_status, c.billsec, c.duration, c.extension, c.has_recording,
             c.uniqueid, c.linkedid, ct.code AS call_type, ct.name AS call_type_name, ct.color AS call_type_color,
             rt.name AS route_name, rp.pattern AS route_pattern, p.name AS pbx_name, t.name AS trunk_name
      FROM app.calls c
      LEFT JOIN app.call_types ct ON ct.id = c.call_type_id
      LEFT JOIN app.routes rt ON rt.id = c.route_id
      LEFT JOIN app.route_patterns rp ON rp.id = c.route_pattern_id
      LEFT JOIN app.pbxs p ON p.id = c.source_pbx_id
      LEFT JOIN app.sip_trunks t ON t.id = c.trunk_id
      WHERE ${where}
      ORDER BY c.start_time DESC, c.id DESC
      LIMIT ${f.limit + 1}`);
    const more = rows.length > f.limit;
    const items = rows.slice(0, f.limit);
    const last = items[items.length - 1];
    return { items, nextCursor: more && last ? encodeCursor(last['start_time'] as Date, String(last['id'])) : null };
  });

  /** Aggregates for the current filter (header cards on search pages). */
  app.get('/calls/summary', { preHandler: app.requirePermission(P.CALLS_VIEW) }, async (req) => {
    const f = parse(callFilterSchema, req.query);
    const where = buildCallWhere({ ...f, cursor: undefined }, req.auth!);
    const [r] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE answer_status='ANSWERED')::int answered,
             count(*) FILTER (WHERE answer_status IN ('NO_ANSWER','ABANDONED'))::int missed,
             count(*) FILTER (WHERE answer_status IN ('FAILED','CONGESTION'))::int failed,
             count(*) FILTER (WHERE answer_status='BUSY')::int busy,
             count(*) FILTER (WHERE direction='INBOUND')::int inbound,
             count(*) FILTER (WHERE direction='OUTBOUND')::int outbound,
             count(*) FILTER (WHERE direction='INTERNAL')::int internal,
             coalesce(sum(billsec),0)::bigint total_billsec,
             coalesce(round(avg(billsec) FILTER (WHERE answer_status='ANSWERED')),0)::int avg_billsec,
             count(*) FILTER (WHERE has_recording)::int recordings
      FROM app.calls c WHERE ${where}`);
    return { ...r, total_billsec: Number(r?.['total_billsec'] ?? 0) };
  });

  app.get('/calls/:id', { preHandler: app.requirePermission(P.CALLS_VIEW) }, async (req) => {
    const { id } = parse(idParam, req.params);
    // Reuse the search restriction so agents cannot open calls they cannot list.
    const where = buildCallWhere({ limit: 1, uniqueId: undefined } as never, req.auth!);
    const ok = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT c.id FROM app.calls c WHERE ${where} AND c.id = ${id}::uuid`);
    if (!ok.length) throw notFound('Call');
    const call = await prisma.call.findUniqueOrThrow({
      where: { id },
      include: {
        sourcePbx: { select: { id: true, name: true, code: true, vendor: true, host: true } },
        destinationPbx: { select: { id: true, name: true, code: true } },
        trunk: { select: { id: true, name: true, host: true, protocol: true } },
        route: { select: { id: true, name: true, routeNumber: true, direction: true, egressTrunk: { select: { name: true } } } },
        routePattern: { select: { id: true, pattern: true, prefix: true } },
        callType: true,
        recordings: { where: { state: { not: 'DELETED' } }, select: { id: true, format: true, layout: true, sizeBytes: true, durationSec: true, state: true, baseName: true } },
        cdrs: { orderBy: { calldate: 'asc' } },
        events: { orderBy: { at: 'asc' } },
      },
    });
    return {
      ...call,
      recordings: call.recordings.map((r) => ({ ...r, sizeBytes: Number(r.sizeBytes) })),
      cdrs: call.cdrs.map((c) => ({ ...c, sourceSeq: Number(c.sourceSeq) })),
      flow: buildFlow(call),
    };
  });
}

/** Data for the visual call-flow diagram (spec §50). */
function buildFlow(call: {
  direction: string; sourcePbx: { name: string } | null; trunk: { name: string } | null;
  route: { name: string; egressTrunk: { name: string } | null } | null; routePattern: { pattern: string; prefix: string | null } | null;
  destinationNumber: string | null; dialedNumber: string | null; hasRecording: boolean; answerStatus: string;
}) {
  const nodes = [
    { id: 'src', kind: 'pbx', label: call.sourcePbx?.name ?? 'Unknown source' },
    { id: 'trunk', kind: 'trunk', label: call.trunk?.name ?? '—', edge: 'SIP INVITE' },
    { id: 'ast', kind: 'asterisk', label: 'Asterisk', edge: call.routePattern ? `Route pattern ${call.routePattern.prefix ?? ''}${call.routePattern.pattern}` : 'No route matched' },
    { id: 'route', kind: 'route', label: call.route?.name ?? 'Unrouted' },
    { id: 'egress', kind: 'trunk', label: call.route?.egressTrunk?.name ?? 'Internal' },
    { id: 'dst', kind: 'destination', label: call.destinationNumber ?? call.dialedNumber ?? '—' },
  ];
  return { nodes, recording: call.hasRecording ? 'AVAILABLE' : 'NONE', status: call.answerStatus };
}
