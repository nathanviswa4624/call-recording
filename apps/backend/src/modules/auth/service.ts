import { hash, verify, Algorithm } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { signAccessToken, type AccessClaims } from './tokens.js';

/** OWASP Argon2id baseline: m=19 MiB, t=2, p=1. */
const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

// Precomputed hash so unknown-user logins take the same time as wrong-password logins.
let dummyHash: Promise<string> | undefined;

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, ARGON_OPTS);
}

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (pw.length > 256) return 'Password is too long';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Password must contain at least 3 of: lowercase, uppercase, digit, symbol';
  return null;
}

export async function loadClaims(userId: string): Promise<AccessClaims> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      siteAccess: true,
    },
  });
  const perms = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) perms.add(rp.permission.code);
  return {
    sub: user.id,
    org: user.organizationId,
    perms: [...perms].sort(),
    sites: user.siteAccess.map((s) => s.siteId),
    pv: user.permissionVersion,
    name: user.displayName,
  };
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  claims: AccessClaims;
}

async function issueRefresh(userId: string, familyId: string, ip?: string, ua?: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 86_400_000);
  const row = await prisma.refreshToken.create({
    data: { userId, familyId, tokenHash: sha256(token), expiresAt, ip, userAgent: ua?.slice(0, 255) },
  });
  return { token, expiresAt, id: row.id };
}

export async function login(params: { organizationSlug?: string; username: string; password: string; ip?: string; userAgent?: string }): Promise<SessionTokens> {
  dummyHash ??= hashPassword(randomToken(16));
  const org = params.organizationSlug
    ? await prisma.organization.findUnique({ where: { slug: params.organizationSlug } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  const user = org
    ? await prisma.user.findFirst({
        where: { organizationId: org.id, OR: [{ username: params.username }, { email: params.username.toLowerCase() }] },
      })
    : null;

  const invalid = new AppError('UNAUTHENTICATED', 'Invalid username or password');
  if (!user) {
    await verify(await dummyHash, params.password).catch(() => false);
    throw invalid;
  }
  if (user.status === 'DISABLED') throw invalid;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('UNAUTHENTICATED', 'Account temporarily locked due to repeated failed logins');
  }

  const ok = await verify(user.passwordHash, params.password).catch(() => false);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      },
    });
    throw invalid;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: params.ip },
  });
  if (user.mfaEnabled) {
    // MFA-ready: second step is handled by /auth/mfa/verify (TOTP) before tokens are issued.
    throw new AppError('UNAUTHENTICATED', 'MFA verification required', { mfaRequired: true });
  }
  const claims = await loadClaims(user.id);
  const refresh = await issueRefresh(user.id, randomUUID(), params.ip, params.userAgent);
  return { accessToken: await signAccessToken(claims), refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt, claims };
}

/** Rotate a refresh token. Reuse of a rotated token revokes the whole family. */
export async function refresh(token: string, ip?: string, userAgent?: string): Promise<SessionTokens> {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  const invalid = new AppError('UNAUTHENTICATED', 'Session expired');
  if (!row) throw invalid;
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw invalid;
  }
  if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw invalid;

  const next = await issueRefresh(row.userId, row.familyId, ip, userAgent);
  const updated = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedBy: next.id },
  });
  if (updated.count !== 1) {
    // Concurrent rotation: treat as reuse.
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw invalid;
  }
  const claims = await loadClaims(row.userId);
  return { accessToken: await signAccessToken(claims), refreshToken: next.token, refreshExpiresAt: next.expiresAt, claims };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (row) await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}
