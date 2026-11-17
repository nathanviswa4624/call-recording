import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasPermission, type Permission } from '@echelons/shared';
import { verifyAccessToken, type AccessClaims } from '../modules/auth/tokens.js';
import { AppError, forbidden } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (...perms: Permission[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Short cache so disabled users / changed roles take effect within ~30s, without a DB hit per request. */
const userStateCache = new Map<string, { at: number; active: boolean; pv: number }>();
const CACHE_MS = 30_000;

async function userState(userId: string) {
  const hit = userStateCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, permissionVersion: true } });
  const state = { at: Date.now(), active: u?.status === 'ACTIVE', pv: u?.permissionVersion ?? -1 };
  userStateCache.set(userId, state);
  if (userStateCache.size > 10_000) userStateCache.clear();
  return state;
}

export function invalidateUserState(userId: string) {
  userStateCache.delete(userId);
}

export function requireAuth(req: FastifyRequest): AccessClaims {
  if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return req.auth;
}

export default fp(async (app) => {
  app.decorateRequest('auth', undefined);

  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    let claims: AccessClaims;
    try {
      claims = await verifyAccessToken(header.slice(7));
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token');
    }
    const state = await userState(claims.sub);
    if (!state.active) throw new AppError('UNAUTHENTICATED', 'Account disabled');
    if (state.pv !== claims.pv) throw new AppError('UNAUTHENTICATED', 'Permissions changed, please refresh session');
    req.auth = claims;
  });

  app.decorate('requirePermission', (...perms: Permission[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) await app.authenticate(req, reply);
    if (!hasPermission(req.auth!.perms, perms)) throw forbidden();
  });
});
