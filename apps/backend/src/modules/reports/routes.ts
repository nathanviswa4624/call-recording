/**
 * Dashboard + reports (spec §19, §35). All aggregates run in SQL over indexed
 * columns and reuse the call filter builder so tenant/agent restrictions apply.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PERMISSIONS as P } from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/errors.js';
import { buildCallWhere, callFilterSchema } from '../calls/search.js';

const num = (v: unknown) => Number(v ?? 0);
const normalize = (rows: Array<Record<string, unknown>>) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));

export async function reportRoutes(app: FastifyInstance) {
  const guard = { preHandler: app.requirePermission(P.REPORTS_VIEW) };

  app.get('/reports/dashboard', guard, async (req) => {
    const q = parse(z.object({ date: z.coerce.date().optional(), days: z.coerce.number().int().min(1).max(90).default(14) }), req.query);
    const dayStart = new Date(q.date ?? new Date());
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const today = buildCallWhere({ from: dayStart, to: dayEnd, limit: 1 }, req.auth!);
    const range = buildCallWhere({ from: new Date(dayStart.getTime() - (q.days - 1) * 86_400_000), to: dayEnd, limit: 1 }, req.auth!);

    const [totals] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) total,
             count(*) FILTER (WHERE answer_status='ANSWERED') answered,
             count(*) FILTER (WHERE answer_status IN ('NO_ANSWER','ABANDONED')) missed,
             count(*) FILTER (WHERE answer_status IN ('FAILED','CONGESTION')) failed,
             count(*) FILTER (WHERE answer_status='BUSY') busy,
             count(*) FILTER (WHERE direction='INBOUND') inbound,
             count(*) FILTER (WHERE direction='OUTBOUND') outbound,
             count(*) FILTER (WHERE direction='INTERNAL') internal
      FROM app.calls c WHERE ${today}`);
    const [rec] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT count(*) total, coalesce(sum(duration_sec),0) duration_sec, coalesce(sum(size_bytes),0) size_bytes
      FROM app.recordings WHERE organization_id = ${req.auth!.org}::uuid AND state IN ('AVAILABLE','ARCHIVED','CLOSED')`);
    const perHour = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT extract(hour FROM start_time)::int AS hour, count(*) calls,
             count(*) FILTER (WHERE direction='INBOUND') inbound, count(*) FILTER (WHERE direction='OUTBOUND') outbound
      FROM app.calls c WHERE ${today} GROUP BY 1 ORDER BY 1`);
    const perDay = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT date_trunc('day', start_time)::date AS day, count(*) calls,
             count(*) FILTER (WHERE answer_status='ANSWERED') answered, coalesce(round(avg(billsec) FILTER (WHERE answer_status='ANSWERED')),0) avg_billsec
      FROM app.calls c WHERE ${range} GROUP BY 1 ORDER BY 1`);
    const byPbx = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT coalesce(p.name,'Unknown') AS label, count(*) calls FROM app.calls c LEFT JOIN app.pbxs p ON p.id = c.source_pbx_id
      WHERE ${range} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
    const byRoute = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT coalesce(r.name,'Unrouted') AS label, count(*) calls FROM app.calls c LEFT JOIN app.routes r ON r.id = c.route_id
      WHERE ${range} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
    const byType = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT coalesce(t.name,'Unclassified') AS label, t.color, count(*) calls FROM app.calls c LEFT JOIN app.call_types t ON t.id = c.call_type_id
      WHERE ${range} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12`);
    const byExt = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT c.extension AS label, count(*) calls FROM app.calls c
      WHERE ${range} AND c.extension IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
    const durationBuckets = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT CASE WHEN billsec < 30 THEN '<30s' WHEN billsec < 60 THEN '30-60s' WHEN billsec < 180 THEN '1-3m'
                  WHEN billsec < 600 THEN '3-10m' ELSE '10m+' END AS bucket, count(*) calls
      FROM app.calls c WHERE ${range} AND answer_status = 'ANSWERED' GROUP BY 1`);
    const [infra] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT (SELECT count(*) FROM app.sip_trunks WHERE organization_id = ${req.auth!.org}::uuid AND enabled) active_trunks,
             (SELECT count(*) FROM app.sip_trunks WHERE organization_id = ${req.auth!.org}::uuid AND enabled AND status = 'UNREACHABLE') failed_trunks,
             (SELECT count(*) FROM app.asterisk_servers WHERE organization_id = ${req.auth!.org}::uuid) servers,
             (SELECT count(*) FROM app.asterisk_servers WHERE organization_id = ${req.auth!.org}::uuid AND status = 'REACHABLE') servers_up`);

    return {
      date: dayStart,
      today: Object.fromEntries(Object.entries(totals ?? {}).map(([k, v]) => [k, num(v)])),
      recordings: { total: num(rec?.['total']), durationSec: num(rec?.['duration_sec']), storageBytes: num(rec?.['size_bytes']) },
      infrastructure: Object.fromEntries(Object.entries(infra ?? {}).map(([k, v]) => [k, num(v)])),
      charts: {
        perHour: normalize(perHour), perDay: normalize(perDay), byPbx: normalize(byPbx), byRoute: normalize(byRoute),
        byCallType: normalize(byType), byExtension: normalize(byExt), durationBuckets: normalize(durationBuckets),
      },
    };
  });

  const groupReports: Record<string, { label: Prisma.Sql; join: Prisma.Sql; extra?: Prisma.Sql }> = {
    agents: { label: Prisma.sql`coalesce(u.display_name, c.extension, 'Unassigned')`, join: Prisma.sql`LEFT JOIN app.users u ON u.id = c.agent_user_id` },
    pbx: { label: Prisma.sql`coalesce(p.name, 'Unknown')`, join: Prisma.sql`LEFT JOIN app.pbxs p ON p.id = c.source_pbx_id` },
    routes: { label: Prisma.sql`coalesce(r.name || ' (' || coalesce(rp.prefix,'') || rp.pattern || ')', r.name, 'Unrouted')`, join: Prisma.sql`LEFT JOIN app.routes r ON r.id = c.route_id LEFT JOIN app.route_patterns rp ON rp.id = c.route_pattern_id` },
    'call-types': { label: Prisma.sql`coalesce(t.name, 'Unclassified')`, join: Prisma.sql`LEFT JOIN app.call_types t ON t.id = c.call_type_id` },
    trunks: { label: Prisma.sql`coalesce(tr.name, 'Unknown')`, join: Prisma.sql`LEFT JOIN app.sip_trunks tr ON tr.id = c.trunk_id` },
    extensions: { label: Prisma.sql`coalesce(c.extension, 'No extension')`, join: Prisma.empty },
  };

  app.get('/reports/:kind', guard, async (req) => {
    const { kind } = parse(z.object({ kind: z.enum(['agents', 'pbx', 'routes', 'call-types', 'trunks', 'extensions']) }), req.params);
    const f = parse(callFilterSchema, req.query);
    const where = buildCallWhere({ ...f, cursor: undefined }, req.auth!);
    const g = groupReports[kind]!;
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${g.label} AS label,
             count(*) calls,
             count(*) FILTER (WHERE c.answer_status='ANSWERED') answered,
             count(*) FILTER (WHERE c.answer_status IN ('NO_ANSWER','ABANDONED')) missed,
             count(*) FILTER (WHERE c.answer_status IN ('FAILED','CONGESTION','BUSY')) failed,
             count(*) FILTER (WHERE c.direction='INBOUND') inbound,
             count(*) FILTER (WHERE c.direction='OUTBOUND') outbound,
             coalesce(sum(c.billsec),0) total_billsec,
             coalesce(round(avg(c.billsec) FILTER (WHERE c.answer_status='ANSWERED')),0) avg_billsec,
             count(*) FILTER (WHERE c.has_recording) recordings
      FROM app.calls c ${g.join}
      WHERE ${where}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1000`);
    return { kind, rows: normalize(rows) };
  });
}
