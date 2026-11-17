import { z } from 'zod';

const base64Key = (bytes: number) =>
  z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === bytes;
    } catch {
      return false;
    }
  }, `must be ${bytes} bytes, base64 encoded`);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PRODUCT_NAME: z.string().default('Echelons Call Recording Platform'),
  PRODUCT_SHORT_NAME: z.string().default('Echelons'),
  DATABASE_URL: z.string().url(),
  BACKEND_HOST: z.string().default('127.0.0.1'),
  BACKEND_PORT: z.coerce.number().int().default(4000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  ENCRYPTION_KEY: base64Key(32),
  CONNECTOR_URL: z.string().url().default('http://127.0.0.1:4100'),
  CONNECTOR_TOKEN: z.string().min(16),
  RECORDING_BASE_PATH: z.string().default('/var/spool/asterisk/recording'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Never print values: only which variables are wrong.
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
