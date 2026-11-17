import type { ZodError, ZodType, ZodTypeDef } from 'zod';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ASTERISK_UNAVAILABLE'
  | 'CONFIG_APPLY_FAILED'
  | 'UNSUPPORTED_PARAMETER'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED_PARAMETER: 422,
  CONFIG_APPLY_FAILED: 422,
  RATE_LIMITED: 429,
  ASTERISK_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly statusCode: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError('FORBIDDEN', msg);

export function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Parse untrusted input or throw a 400 with field-level details. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError('VALIDATION_FAILED', 'Request validation failed', zodDetails(r.error));
  return r.data;
}
