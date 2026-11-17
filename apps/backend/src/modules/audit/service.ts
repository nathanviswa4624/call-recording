import type { FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';

const SECRET_KEYS = /^(password|secret|md5_cred|oauth_secret|refresh_token|passwordEnc|secretEnc|accessKeyEnc|secretKeyEnc|connectorTokenEnc|token)$/i;

/** Replace secret values with a mask before they are written to the audit trail. */
export function maskSecrets(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(maskSecrets);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? (v ? '••••' : v) : maskSecrets(v);
  }
  return out;
}

/** Compact field diff for display ("transport UDP → TCP"). */
export function diffObjects(oldV: unknown, newV: unknown): Array<{ field: string; from: unknown; to: unknown }> {
  const a = (oldV ?? {}) as Record<string, unknown>;
  const b = (newV ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changes.push({ field: k, from: a[k], to: b[k] });
  }
  return changes;
}

export interface AuditEntry {
  action: string;
  objectType?: string;
  objectId?: string;
  objectLabel?: string;
  oldValue?: unknown;
  newValue?: unknown;
  result: 'SUCCESS' | 'FAILURE';
  error?: string;
}

const json = (v: unknown) => (v === undefined ? undefined : (maskSecrets(v) as Prisma.InputJsonValue));

export async function audit(req: FastifyRequest | null, entry: AuditEntry, tx?: Tx, orgOverride?: string): Promise<void> {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      organizationId: orgOverride ?? req?.auth?.org ?? null,
      userId: req?.auth?.sub ?? null,
      ip: req?.ip,
      userAgent: req?.headers['user-agent']?.slice(0, 255),
      requestId: req?.id,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      objectLabel: entry.objectLabel,
      oldValue: json(entry.oldValue),
      newValue: json(entry.newValue),
      result: entry.result,
      error: entry.error?.slice(0, 2000),
    },
  });
}
