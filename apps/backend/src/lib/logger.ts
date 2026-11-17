import type { LoggerOptions } from 'pino';

/** Paths that must never be logged (docs/08 §4). */
export const REDACT_PATHS = [
  'password', '*.password', '*.*.password', 'secret', '*.secret', 'newPassword', 'currentPassword',
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-connector-token"]',
  'res.headers["set-cookie"]', 'accessKey', 'secretKey', '*.secretKey', '*.accessKey', 'token', '*.token',
  'refreshToken', 'md5_cred', '*.md5_cred', 'Secret',
];

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'echelons-backend' },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
