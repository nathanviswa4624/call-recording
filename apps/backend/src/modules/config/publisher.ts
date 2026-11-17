/**
 * Writes PJSIP objects into the Sorcery realtime tables (asterisk.ps_*).
 *
 * - Runs in ONE transaction: Asterisk (separate ODBC connection, READ COMMITTED)
 *   sees either the complete old or the complete new configuration.
 * - Identifiers (schema/table/column) are validated against an allowlist and
 *   information_schema; values are always bound parameters.
 * - Column existence is how Asterisk-version schema differences surface:
 *   an option without a column is UNSUPPORTED_PARAMETER, before any write.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { findOption, SORCERY_TABLES, toAsteriskValue, type PjsipObjectRef, type PjsipObjectType } from '@echelons/shared';
import { AppError } from '../../lib/errors.js';

export type RealtimeRows = Record<string, Array<Record<string, string | null>>>;

const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const COLUMN_RE = /^[a-z0-9_]{1,64}$/;

const PUBLISHED_TYPES = (Object.keys(SORCERY_TABLES) as PjsipObjectType[]).filter((t) => SORCERY_TABLES[t] !== null);

function ident(name: string, re: RegExp): Prisma.Sql {
  if (!re.test(name)) throw new AppError('INTERNAL', `unsafe SQL identifier "${name}"`);
  return Prisma.raw(`"${name}"`);
}

let publisherClient: PrismaClient | undefined;

/** Separate pool using the publisher role when configured (docs/08 §4). */
export function publisherDb(): PrismaClient {
  publisherClient ??= new PrismaClient({
    datasources: { db: { url: process.env.PUBLISHER_DATABASE_URL ?? process.env.DATABASE_URL! } },
  });
  return publisherClient;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function tableColumns(db: Db, schema: string): Promise<Map<string, Set<string>>> {
  if (!SCHEMA_RE.test(schema)) throw new AppError('INTERNAL', 'invalid realtime schema');
  const tables = PUBLISHED_TYPES.map((t) => SORCERY_TABLES[t]!);
  const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name IN (${Prisma.join(tables)})`;
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, new Set());
    map.get(r.table_name)!.add(r.column_name);
  }
  return map;
}

/** Convert objects to realtime rows, checking every option has a column. */
export function toRealtimeRows(objects: PjsipObjectRef[], columns: Map<string, Set<string>>): { rows: RealtimeRows; issues: Array<{ object: string; field: string; message: string }> } {
  const rows: RealtimeRows = {};
  const issues: Array<{ object: string; field: string; message: string }> = [];
  for (const t of PUBLISHED_TYPES) rows[SORCERY_TABLES[t]!] = [];
  for (const o of objects) {
    const table = SORCERY_TABLES[o.type];
    if (!table) continue;
    const cols = columns.get(table);
    if (!cols) {
      issues.push({ object: o.name, field: '-', message: `realtime table ${table} does not exist` });
      continue;
    }
    const row: Record<string, string | null> = { id: o.name };
    for (const [k, v] of Object.entries(o.params)) {
      const value = toAsteriskValue(findOption(o.type, k), v);
      if (value === null) continue;
      if (!cols.has(k)) {
        issues.push({ object: o.name, field: k, message: `option "${k}" is not supported by this Asterisk realtime schema (${table} has no such column)` });
        continue;
      }
      row[k] = value;
    }
    rows[table]!.push(row);
  }
  return { rows, issues };
}

export async function readRealtimeRows(db: Db, schema: string): Promise<RealtimeRows> {
  const out: RealtimeRows = {};
  for (const t of PUBLISHED_TYPES) {
    const table = SORCERY_TABLES[t]!;
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM ${ident(schema, SCHEMA_RE)}.${ident(table, COLUMN_RE)}`;
    out[table] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? null : String(v)])));
  }
  return out;
}

/** Atomically replace all realtime rows with `rows`. */
export async function writeRealtimeRows(db: PrismaClient, schema: string, rows: RealtimeRows): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const [table, list] of Object.entries(rows)) {
      const s = ident(schema, SCHEMA_RE);
      const tb = ident(table, COLUMN_RE);
      await tx.$executeRaw`DELETE FROM ${s}.${tb}`;
      for (const row of list) {
        for (const k of Object.keys(row)) ident(k, COLUMN_RE); // validate keys
        // json_populate_record coerces text into the realtime enum types (yesno_values, ...)
        // that a text-typed bind parameter would not be implicitly cast to.
        await tx.$executeRaw`INSERT INTO ${s}.${tb} SELECT * FROM json_populate_record(NULL::${s}.${tb}, ${JSON.stringify(row)}::json)`;
      }
    }
  }, { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Split auth secrets out of rows (for storing a redacted snapshot). */
export function redactRows(rows: RealtimeRows): { redacted: RealtimeRows; secrets: Record<string, Record<string, string>> } {
  const secrets: Record<string, Record<string, string>> = {};
  const redacted: RealtimeRows = {};
  for (const [table, list] of Object.entries(rows)) {
    redacted[table] = list.map((r) => {
      const copy = { ...r };
      for (const k of ['password', 'md5_cred', 'oauth_secret', 'refresh_token', 'password_digest']) {
        if (copy[k]) {
          secrets[`${table}:${r['id']}`] = { ...(secrets[`${table}:${r['id']}`] ?? {}), [k]: copy[k]! };
          copy[k] = null;
        }
      }
      return copy;
    });
  }
  return { redacted, secrets };
}

export function restoreSecrets(redacted: RealtimeRows, secrets: Record<string, Record<string, string>>): RealtimeRows {
  const out: RealtimeRows = {};
  for (const [table, list] of Object.entries(redacted)) {
    out[table] = list.map((r) => ({ ...r, ...(secrets[`${table}:${r['id']}`] ?? {}) }));
  }
  return out;
}
