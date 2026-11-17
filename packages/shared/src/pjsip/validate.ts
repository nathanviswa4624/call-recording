import { findOption, type OptionSpec, type PjsipObjectType } from './catalog.js';

export interface ValidationIssue {
  object: string;
  field: string;
  code: 'UNKNOWN_PARAMETER' | 'UNSUPPORTED_PARAMETER' | 'INVALID_VALUE' | 'MISSING_REFERENCE' | 'CONFLICT' | 'REQUIRED';
  message: string;
  severity: 'error' | 'warning';
}

export type ParamValue = string | number | boolean | null | undefined;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-]{0,79}$/;
const CODEC_RE = /^[a-z0-9_!]+$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function isValidObjectName(name: string): boolean {
  return NAME_RE.test(name);
}

export function isIpOrCidr(v: string): boolean {
  const s = v.trim();
  const [addr, mask, ...rest] = s.split('/');
  if (rest.length || !addr) return false;
  const isV6 = addr.includes(':');
  if (isV6) {
    if (!/^[0-9a-fA-F:]+$/.test(addr) || (addr.match(/::/g) ?? []).length > 1) return false;
    if (mask !== undefined && !(/^\d{1,3}$/.test(mask) && Number(mask) <= 128)) return false;
    return true;
  }
  if (!IPV4.test(addr)) return false;
  if (mask !== undefined) {
    if (/^\d{1,2}$/.test(mask)) return Number(mask) <= 32;
    return IPV4.test(mask); // dotted netmask form accepted by Asterisk
  }
  return true;
}

/**
 * Characters that must never appear in a PJSIP value (line/record injection guard).
 * ';' is deliberately allowed: it is required in SIP URIs (e.g. contact
 * "sip:host:5060;transport=tcp", outbound_proxy "...;lr") and these values are
 * stored in the Sorcery realtime tables, not written as config-file lines.
 * Values that ARE written to a config file (transports) are additionally
 * rejected for ';' by compileTransports() in the backend.
 */
const FORBIDDEN = /[\r\n\0]/;

export function validateValue(spec: OptionSpec, raw: ParamValue): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof v === 'string' && FORBIDDEN.test(v)) return 'contains forbidden characters (line break or NUL)';
  const t = spec.type;
  switch (t.t) {
    case 'bool':
      if (typeof v === 'boolean') return null;
      return /^(yes|no|true|false|on|off|1|0)$/i.test(String(v)) ? null : 'must be yes/no';
    case 'int': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(n)) return 'must be an integer';
      if (t.min !== undefined && n < t.min) return `must be >= ${t.min}`;
      if (t.max !== undefined && n > t.max) return `must be <= ${t.max}`;
      return null;
    }
    case 'enum':
      return t.values.includes(String(v)) ? null : `must be one of: ${t.values.join(', ')}`;
    case 'string':
    case 'secret': {
      const s = String(v);
      const max = t.t === 'string' ? t.max ?? 255 : 255;
      if (s.length > max) return `must be at most ${max} characters`;
      if (t.t === 'string' && t.pattern && !t.pattern.test(s)) return 'has an invalid format';
      return null;
    }
    case 'list':
      return String(v).split(',').every((x) => NAME_RE.test(x.trim())) ? null : 'must be a comma-separated list of object names';
    case 'codecs':
      return String(v).split(',').every((x) => CODEC_RE.test(x.trim())) ? null : 'must be a comma-separated codec list';
    case 'ipList':
      return String(v)
        .split(',')
        .map((x) => x.trim())
        .every((x) => isIpOrCidr(x) || HOST.test(x))
        ? null
        : 'must be a comma-separated list of IP, CIDR or hostnames';
  }
}

/** Convert an application value to the textual form Asterisk expects. */
export function toAsteriskValue(spec: OptionSpec | undefined, raw: ParamValue): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (spec?.type.t === 'bool') {
    if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
    return /^(yes|true|on|1)$/i.test(String(raw)) ? 'yes' : 'no';
  }
  return String(raw).trim();
}

export interface ValidateOptions {
  asteriskMajor: number;
  /** When false, unknown parameters produce warnings instead of errors (admin override). */
  strictCatalog?: boolean;
}

/**
 * Validate a flat parameter map for a PJSIP object against the catalog for the
 * given Asterisk major version.
 */
export function validatePjsipObject(
  type: PjsipObjectType,
  name: string,
  params: Record<string, ParamValue>,
  opts: ValidateOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const strict = opts.strictCatalog !== false;
  if (type !== 'global' && !isValidObjectName(name)) {
    issues.push({ object: name, field: 'name', code: 'INVALID_VALUE', severity: 'error', message: 'Name must be 1-80 chars of letters, digits, _ . - and start with a letter or digit' });
  }
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-z0-9_]{1,64}$/.test(key)) {
      issues.push({ object: name, field: key, code: 'UNKNOWN_PARAMETER', severity: 'error', message: `Invalid parameter name "${key}"` });
      continue;
    }
    const spec = findOption(type, key);
    if (!spec) {
      issues.push({ object: name, field: key, code: 'UNKNOWN_PARAMETER', severity: strict ? 'error' : 'warning', message: `"${key}" is not a known ${type} option` });
      continue;
    }
    if (spec.since !== undefined && opts.asteriskMajor < spec.since) {
      issues.push({ object: name, field: key, code: 'UNSUPPORTED_PARAMETER', severity: 'error', message: `"${key}" requires Asterisk ${spec.since}+ (server runs ${opts.asteriskMajor})` });
      continue;
    }
    if (spec.removedIn !== undefined && opts.asteriskMajor >= spec.removedIn) {
      issues.push({ object: name, field: key, code: 'UNSUPPORTED_PARAMETER', severity: 'error', message: `"${key}" was removed in Asterisk ${spec.removedIn}` });
      continue;
    }
    const err = validateValue(spec, value);
    if (err) issues.push({ object: name, field: key, code: 'INVALID_VALUE', severity: 'error', message: `${key} ${err}` });
  }
  if (type === 'identify' && !params['match'] && !params['match_header'] && !params['match_request_uri']) {
    issues.push({ object: name, field: 'match', code: 'REQUIRED', severity: 'error', message: 'identify needs match, match_header or match_request_uri' });
  }
  if (type === 'identify' && !params['endpoint']) {
    issues.push({ object: name, field: 'endpoint', code: 'REQUIRED', severity: 'error', message: 'identify needs an endpoint' });
  }
  if (type === 'auth') {
    const at = String(params['auth_type'] ?? 'userpass');
    if (at === 'userpass' && (!params['username'] || !params['password'])) {
      issues.push({ object: name, field: 'password', code: 'REQUIRED', severity: 'error', message: 'userpass auth requires username and password' });
    }
    if (at === 'md5' && (!params['username'] || !params['md5_cred'])) {
      issues.push({ object: name, field: 'md5_cred', code: 'REQUIRED', severity: 'error', message: 'md5 auth requires username and md5_cred' });
    }
  }
  return issues;
}

export interface PjsipObjectRef {
  type: PjsipObjectType;
  name: string;
  params: Record<string, ParamValue>;
}

/**
 * Cross-object checks: references resolve, no identify conflicts.
 * `objects` is the full set that will be published for one server.
 */
export function validateReferences(objects: readonly PjsipObjectRef[], externalNames: { transports?: string[] } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const names = (t: PjsipObjectType) => new Set(objects.filter((o) => o.type === t).map((o) => o.name));
  const endpoints = names('endpoint');
  const aors = names('aor');
  const auths = names('auth');
  const transports = new Set([...names('transport'), ...(externalNames.transports ?? [])]);

  for (const o of objects) {
    const p = o.params;
    const ref = (field: string, set: Set<string>, kind: string) => {
      const v = p[field];
      if (v === undefined || v === null || v === '') return;
      for (const n of String(v).split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!set.has(n)) issues.push({ object: o.name, field, code: 'MISSING_REFERENCE', severity: 'error', message: `${kind} "${n}" does not exist` });
      }
    };
    if (o.type === 'endpoint') {
      ref('transport', transports, 'transport');
      ref('aors', aors, 'AOR');
      ref('auth', auths, 'auth');
      ref('outbound_auth', auths, 'auth');
    }
    if (o.type === 'identify') ref('endpoint', endpoints, 'endpoint');
    if (o.type === 'registration') {
      ref('outbound_auth', auths, 'auth');
      ref('transport', transports, 'transport');
      ref('endpoint', endpoints, 'endpoint');
    }
  }

  // Identify conflict: the same IP/CIDR string mapped to two endpoints.
  const seen = new Map<string, string>();
  for (const o of objects.filter((x) => x.type === 'identify')) {
    for (const m of String(o.params['match'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const prev = seen.get(m);
      const ep = String(o.params['endpoint'] ?? '');
      if (prev && prev !== ep) {
        issues.push({ object: o.name, field: 'match', code: 'CONFLICT', severity: 'error', message: `${m} is already mapped to endpoint "${prev}"` });
      } else seen.set(m, ep);
    }
  }

  // Transport bind clash
  const binds = new Map<string, string>();
  for (const t of objects.filter((x) => x.type === 'transport')) {
    const key = `${t.params['protocol'] ?? 'udp'}|${t.params['bind'] ?? '0.0.0.0:5060'}`;
    const prev = binds.get(key);
    if (prev) issues.push({ object: t.name, field: 'bind', code: 'CONFLICT', severity: 'error', message: `bind ${key.replace('|', ' ')} already used by transport "${prev}"` });
    else binds.set(key, t.name);
  }
  return issues;
}
