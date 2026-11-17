/**
 * Call / recording search filter builder with keyset pagination (docs/03, spec §20).
 * Applies tenant, site and agent ("own/granted") restrictions in SQL.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasPermission, PERMISSIONS as P } from '@echelons/shared';
import type { AccessClaims } from '../auth/tokens.js';
import { compilePattern } from '@echelons/shared';

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item).max(50));

export const callFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** HH:MM-HH:MM time-of-day window (server timezone). */
  timeOfDay: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).optional(),
  caller: z.string().max(64).optional(),
  destination: z.string().max(64).optional(),
  /** Matches either party. */
  number: z.string().max(64).optional(),
  extension: z.string().max(32).optional(),
  pbxId: csv(z.string().uuid()).optional(),
  trunkId: csv(z.string().uuid()).optional(),
  routeId: csv(z.string().uuid()).optional(),
  routePatternId: csv(z.string().uuid()).optional(),
  /** Destination numbers matching an Asterisk pattern (independent of stored route). */
  destinationPattern: z.string().max(80).optional(),
  callTypeId: csv(z.string().uuid()).optional(),
  direction: csv(z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT', 'UNKNOWN'])).optional(),
  status: csv(z.enum(['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CONGESTION', 'ABANDONED'])).optional(),
  minDuration: z.coerce.number().int().min(0).optional(),
  maxDuration: z.coerce.number().int().min(0).optional(),
  agentUserId: z.string().uuid().optional(),
  department: z.string().max(80).optional(),
  queue: z.string().max(80).optional(),
  campaign: z.string().max(80).optional(),
  recordingId: z.string().uuid().optional(),
  uniqueId: z.string().max(64).optional(),
  hasRecording: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  tag: z.string().max(48).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(200).optional(),
});
export type CallFilter = z.infer<typeof callFilterSchema>;

/** Escape LIKE wildcards in user input. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Convert an Asterisk pattern into a safe POSIX regex for Postgres. */
export function patternToPgRegex(p: string): string {
  const cp = compilePattern(p);
  let re = '^';
  for (const t of cp.tokens) {
    if (t.kind === 'set') {
      const chars = [...t.chars].map((c) => c.replace(/[\\^\-\]\[*+#]/g, (m) => `\\${m}`)).join('');
      re += `[${chars}]`;
    } else if (t.kind === 'oneOrMore') re += '.+';
    else re += '.*';
  }
  return `${re}$`;
}

export function encodeCursor(startTime: Date, id: string) {
  return Buffer.from(`${startTime.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(c: string): { t: Date; id: string } | null {
  const [t, id] = Buffer.from(c, 'base64url').toString().split('|');
  if (!t || !id || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(Date.parse(t))) return null;
  return { t: new Date(t), id };
}

/** Build WHERE conditions for app.calls (alias c). */
export function buildCallWhere(f: CallFilter, auth: AccessClaims): Prisma.Sql {
  const w: Prisma.Sql[] = [Prisma.sql`c.organization_id = ${auth.org}::uuid`];
  if (auth.sites.length) w.push(Prisma.sql`(c.site_id IS NULL OR c.site_id = ANY(${auth.sites}::uuid[]))`);

  // Agent restriction: only own extensions / assigned calls / explicit grants.
  if (!hasPermission(auth.perms, P.RECORDINGS_VIEW_ALL)) {
    // ARRAY(SELECT unnest(...)) turns the user's text[] into a set ANY() can compare element-wise.
    const ownExt = Prisma.sql`ARRAY(SELECT unnest(u.extensions) FROM app.users u WHERE u.id = ${auth.sub}::uuid)`;
    w.push(Prisma.sql`(
      c.agent_user_id = ${auth.sub}::uuid
      OR c.extension = ANY(${ownExt})
      OR c.caller_number = ANY(${ownExt})
      OR c.destination_number = ANY(${ownExt})
      OR EXISTS (SELECT 1 FROM app.recordings r JOIN app.recording_access_grants g ON g.recording_id = r.id
                 WHERE r.call_id = c.id AND g.user_id = ${auth.sub}::uuid AND (g.expires_at IS NULL OR g.expires_at > now())))`);
  }

  if (f.from) w.push(Prisma.sql`c.start_time >= ${f.from}`);
  if (f.to) w.push(Prisma.sql`c.start_time < ${f.to}`);
  if (f.timeOfDay) {
    const [a, b] = f.timeOfDay.split('-');
    w.push(Prisma.sql`c.start_time::time BETWEEN ${a}::time AND ${b}::time`);
  }
  if (f.caller) w.push(Prisma.sql`c.caller_number LIKE ${`%${likeEscape(f.caller)}%`}`);
  if (f.destination) w.push(Prisma.sql`c.destination_number LIKE ${`%${likeEscape(f.destination)}%`}`);
  if (f.number) w.push(Prisma.sql`(c.caller_number LIKE ${`%${likeEscape(f.number)}%`} OR c.destination_number LIKE ${`%${likeEscape(f.number)}%`})`);
  if (f.extension) w.push(Prisma.sql`c.extension = ${f.extension}`);
  if (f.pbxId?.length) w.push(Prisma.sql`(c.source_pbx_id = ANY(${f.pbxId}::uuid[]) OR c.destination_pbx_id = ANY(${f.pbxId}::uuid[]))`);
  if (f.trunkId?.length) w.push(Prisma.sql`c.trunk_id = ANY(${f.trunkId}::uuid[])`);
  if (f.routeId?.length) w.push(Prisma.sql`c.route_id = ANY(${f.routeId}::uuid[])`);
  if (f.routePatternId?.length) w.push(Prisma.sql`c.route_pattern_id = ANY(${f.routePatternId}::uuid[])`);
  if (f.destinationPattern) w.push(Prisma.sql`c.dialed_number ~ ${patternToPgRegex(f.destinationPattern)}`);
  if (f.callTypeId?.length) w.push(Prisma.sql`c.call_type_id = ANY(${f.callTypeId}::uuid[])`);
  if (f.direction?.length) w.push(Prisma.sql`c.direction::text = ANY(${f.direction}::text[])`);
  if (f.status?.length) w.push(Prisma.sql`c.answer_status::text = ANY(${f.status}::text[])`);
  if (f.minDuration !== undefined) w.push(Prisma.sql`c.billsec >= ${f.minDuration}`);
  if (f.maxDuration !== undefined) w.push(Prisma.sql`c.billsec <= ${f.maxDuration}`);
  if (f.agentUserId) w.push(Prisma.sql`c.agent_user_id = ${f.agentUserId}::uuid`);
  if (f.department) w.push(Prisma.sql`c.department = ${f.department}`);
  if (f.queue) w.push(Prisma.sql`c.queue = ${f.queue}`);
  if (f.campaign) w.push(Prisma.sql`c.campaign = ${f.campaign}`);
  if (f.uniqueId) w.push(Prisma.sql`(c.uniqueid = ${f.uniqueId} OR c.linkedid = ${f.uniqueId})`);
  if (f.recordingId) w.push(Prisma.sql`EXISTS (SELECT 1 FROM app.recordings r WHERE r.call_id = c.id AND r.id = ${f.recordingId}::uuid)`);
  if (f.hasRecording !== undefined) w.push(Prisma.sql`c.has_recording = ${f.hasRecording}`);
  if (f.tag) w.push(Prisma.sql`(${f.tag} = ANY(c.tags) OR EXISTS (SELECT 1 FROM app.recordings r JOIN app.recording_tags t ON t.recording_id = r.id WHERE r.call_id = c.id AND t.tag = ${f.tag}))`);
  if (f.cursor) {
    const cur = decodeCursor(f.cursor);
    if (cur) w.push(Prisma.sql`(c.start_time, c.id) < (${cur.t}, ${cur.id}::uuid)`);
  }
  return Prisma.join(w, ' AND ');
}
