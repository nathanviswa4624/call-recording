import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/errors.js';
import { randomToken, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../audit/service.js';
import * as auth from './service.js';
import { prisma } from '../../lib/prisma.js';

const REFRESH_COOKIE = 'ech_rt';
const CSRF_COOKIE = 'ech_csrf';

function setSessionCookies(reply: FastifyReply, refreshToken: string, expires: Date) {
  const secure = process.env.NODE_ENV === 'production';
  reply.setCookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api/auth', expires });
  // Double-submit CSRF token: readable by JS, must be echoed in X-CSRF-Token for cookie-authenticated calls.
  reply.setCookie(CSRF_COOKIE, randomToken(24), { httpOnly: false, secure, sameSite: 'strict', path: '/', expires });
}

function assertCsrf(cookies: Record<string, string | undefined>, header: string | string[] | undefined) {
  const c = cookies[CSRF_COOKIE];
  const h = Array.isArray(header) ? header[0] : header;
  if (!c || !h || !safeEqual(c, h)) throw new AppError('FORBIDDEN', 'CSRF token missing or invalid');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parse(z.object({
      username: z.string().min(1).max(254),
      password: z.string().min(1).max(256),
      organization: z.string().max(64).optional(),
    }), req.body);
    try {
      const s = await auth.login({ organizationSlug: body.organization, username: body.username, password: body.password, ip: req.ip, userAgent: req.headers['user-agent'] });
      setSessionCookies(reply, s.refreshToken, s.refreshExpiresAt);
      req.auth = s.claims;
      await audit(req, { action: 'auth.login', objectType: 'user', objectId: s.claims.sub, objectLabel: body.username, result: 'SUCCESS' });
      return { accessToken: s.accessToken, user: { id: s.claims.sub, name: s.claims.name, permissions: s.claims.perms, organizationId: s.claims.org } };
    } catch (e) {
      await audit(req, { action: 'auth.login', objectType: 'user', objectLabel: body.username, result: 'FAILURE', error: (e as Error).message }).catch(() => undefined);
      throw e;
    }
  });

  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    assertCsrf(req.cookies, req.headers['x-csrf-token']);
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new AppError('UNAUTHENTICATED', 'No session');
    const s = await auth.refresh(token, req.ip, req.headers['user-agent']);
    setSessionCookies(reply, s.refreshToken, s.refreshExpiresAt);
    return { accessToken: s.accessToken, user: { id: s.claims.sub, name: s.claims.name, permissions: s.claims.perms, organizationId: s.claims.org } };
  });

  app.post('/auth/logout', async (req, reply) => {
    assertCsrf(req.cookies, req.headers['x-csrf-token']);
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const a = req.auth!;
    const [org, user] = await Promise.all([
      prisma.organization.findUnique({ where: { id: a.org }, select: { name: true, slug: true } }),
      prisma.user.findUnique({ where: { id: a.sub }, select: { username: true, email: true, extensions: true, department: true, mfaEnabled: true } }),
    ]);
    return { id: a.sub, name: a.name, organizationId: a.org, organization: org, permissions: a.perms, sites: a.sites, ...user };
  });
}
