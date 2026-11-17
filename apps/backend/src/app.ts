import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { trunkRoutes } from './modules/trunks/routes.js';
import { pjsipRoutes } from './modules/pjsip/routes.js';
import { routingRoutes } from './modules/routing/routes.js';
import { configRoutes } from './modules/config/routes.js';
import { asteriskRoutes } from './modules/asterisk/routes.js';
import { callRoutes } from './modules/calls/routes.js';
import { recordingRoutes } from './modules/recordings/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { retentionRoutes } from './modules/retention/routes.js';
import { setupRoutes } from './modules/setup/routes.js';
import { metaRoutes } from './modules/meta/routes.js';

export async function buildApp() {
  const e = env();
  const app = Fastify({
    logger: loggerOptions(e.LOG_LEVEL),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: '127.0.0.1',
    bodyLimit: 1_048_576,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: e.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.sub ?? req.ip,
  });
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, err.message);
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    if ((err as FastifyError).statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id } });
    }
    if ((err as FastifyError).validation || (err as FastifyError).statusCode === 400) {
      return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: err.message, requestId: req.id } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error', requestId: req.id } });
  });

  app.get('/api/health', async () => ({ ok: true, product: e.PRODUCT_NAME }));
  app.get('/api/branding', async () => ({ productName: e.PRODUCT_NAME, shortName: e.PRODUCT_SHORT_NAME }));

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(userRoutes);
    await api.register(trunkRoutes);
    await api.register(pjsipRoutes);
    await api.register(routingRoutes);
    await api.register(configRoutes);
    await api.register(asteriskRoutes);
    await api.register(callRoutes);
    await api.register(recordingRoutes);
    await api.register(reportRoutes);
    await api.register(retentionRoutes);
    await api.register(setupRoutes);
    await api.register(metaRoutes);
  }, { prefix: '/api' });

  return app;
}
