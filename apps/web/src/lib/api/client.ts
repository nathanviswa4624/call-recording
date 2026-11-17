/**
 * Central API client.
 *
 * Security model (docs/08): the short-lived access token lives ONLY in memory
 * (never localStorage). The refresh token is an HttpOnly cookie scoped to
 * /api/auth that JavaScript cannot read; refresh calls echo the readable CSRF
 * cookie in X-CSRF-Token (double-submit). A 401 triggers one shared refresh
 * attempt, then the original request is retried once.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
}

export interface SessionUser {
  id: string;
  name: string;
  permissions: string[];
  organizationId: string;
}

interface SessionResponse { accessToken: string; user: SessionUser }

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
const listeners = new Set<(u: SessionUser | null) => void>();

export function onSessionChange(fn: (u: SessionUser | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(u: SessionUser | null) { for (const l of listeners) l(u); }

export function getAccessToken() { return accessToken; }
export function setSession(s: SessionResponse | null) {
  accessToken = s?.accessToken ?? null;
  emit(s?.user ?? null);
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: ApiErrorBody } | undefined;
  try { body = await res.json(); } catch { /* non-JSON */ }
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText ?? 'Request failed', e?.details, e?.requestId);
}

/** Refresh the session from the HttpOnly cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshing ??= (async () => {
    try {
      const csrf = readCookie('ech_csrf');
      if (!csrf) return null;
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': csrf } });
      if (!res.ok) return null;
      const s = (await res.json()) as SessionResponse;
      setSession(s);
      return s;
    } catch {
      return null;
    } finally {
      queueMicrotask(() => { refreshing = null; });
    }
  })();
  return refreshing;
}

export type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export function toQueryString(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); continue; }
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents infinite refresh loops. */
  retried?: boolean;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}${toQueryString(opts.query)}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (res.status === 401 && !opts.retried && !path.startsWith('/auth/login')) {
    const s = await refreshSession();
    if (s) return request<T>(method, path, { ...opts, retried: true });
    setSession(null);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};

/** Human-readable message for any thrown value, never leaking stack traces. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Unexpected error';
}

/** Field-level validation details from a VALIDATION_FAILED response. */
export function errorDetails(e: unknown): Array<{ path?: string; field?: string; object?: string; message: string }> {
  if (e instanceof ApiError && Array.isArray(e.details)) return e.details as Array<{ message: string }>;
  return [];
}
