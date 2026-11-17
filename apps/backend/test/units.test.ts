import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SecretBox, hashObject, stableStringify } from '../src/lib/crypto.js';
import { confine, parseRange } from '../src/modules/storage/drivers.js';
import { patternToPgRegex } from '../src/modules/calls/search.js';
import { resolveExpiry } from '../src/modules/retention/policy.js';
import { redactRows, restoreSecrets, toRealtimeRows } from '../src/modules/config/publisher.js';
import { maskSecrets } from '../src/modules/audit/service.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));
  it('round-trips and binds AAD', () => {
    const ct = box.encrypt('s3cret!', 'sip_auth:1');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(box.decrypt(ct, 'sip_auth:1')).toBe('s3cret!');
    expect(() => box.decrypt(ct, 'sip_auth:2')).toThrow();
  });
  it('detects tampering', () => {
    const ct = box.encrypt('x');
    const parts = ct.split(':');
    parts[3] = Buffer.from('y').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });
});

describe('hashing', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
  });
});

describe('storage path confinement', () => {
  it('accepts nested relative paths', () => {
    expect(confine('/var/spool/rec', '2026/11/16/AVAYA/x.wav')).toMatch(/2026[\\/]11[\\/]16[\\/]AVAYA[\\/]x\.wav$/);
  });
  it('rejects traversal and absolute paths', () => {
    for (const bad of ['../etc/passwd', '2026/../../x', '/etc/passwd', 'a\0b', '']) {
      expect(() => confine('/var/spool/rec', bad), bad).toThrow();
    }
  });
});

describe('HTTP range parsing', () => {
  it('parses ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=2000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange(undefined, 1000)).toBeNull();
  });
});

describe('patternToPgRegex', () => {
  it('converts Asterisk patterns to anchored POSIX regex', () => {
    const re = new RegExp(patternToPgRegex('9XXXXXXXXXX'));
    expect(re.test('90501234567')).toBe(true);
    expect(re.test('9050123456')).toBe(false);
    expect(new RegExp(patternToPgRegex('00X.')).test('00971')).toBe(true);
    expect(() => patternToPgRegex("9X'); DROP TABLE x;--")).toThrow();
  });
});

describe('retention resolution', () => {
  const s = { startedAt: new Date('2026-01-01T00:00:00Z'), pbxId: 'p1', callTypeId: 'intl', routeId: null, department: null, layout: 'MIXED' as const };
  it('longest matching policy wins, unlimited beats all, no policy keeps', () => {
    const base = { pbxId: null, callTypeId: null, routeId: null, department: null, layout: null };
    expect(resolveExpiry([{ ...base, keepDays: 30 }, { ...base, callTypeId: 'intl', keepDays: 365 }], s)?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(resolveExpiry([{ ...base, keepDays: 30 }, { ...base, keepDays: null }], s)).toBeNull();
    expect(resolveExpiry([{ ...base, pbxId: 'other', keepDays: 1 }], s)).toBeNull();
  });
});

describe('realtime rows', () => {
  const cols = new Map([
    ['ps_endpoints', new Set(['id', 'transport', 'context', 'direct_media', 'aors'])],
    ['ps_auths', new Set(['id', 'auth_type', 'username', 'password'])],
    ['ps_aors', new Set(['id'])], ['ps_endpoint_id_ips', new Set(['id'])], ['ps_registrations', new Set(['id'])],
    ['ps_globals', new Set(['id'])], ['ps_domain_aliases', new Set(['id'])],
  ]);
  it('maps params to columns and flags unsupported options', () => {
    const { rows, issues } = toRealtimeRows([
      { type: 'endpoint', name: 'AVAYA', params: { transport: 'transport-tcp', direct_media: false, security_negotiation: 'mediasec' } },
      { type: 'auth', name: 'A-auth', params: { auth_type: 'userpass', username: 'u', password: 'p' } },
    ], cols);
    expect(rows['ps_endpoints']).toEqual([{ id: 'AVAYA', transport: 'transport-tcp', direct_media: 'no' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('security_negotiation');
    const { redacted, secrets } = redactRows(rows);
    expect(redacted['ps_auths']![0]!['password']).toBeNull();
    expect(restoreSecrets(redacted, secrets)['ps_auths']![0]!['password']).toBe('p');
  });
  it('masks secrets in audit values', () => {
    expect(maskSecrets({ username: 'u', password: 'p', nested: { secret: 'x' } })).toEqual({ username: 'u', password: '••••', nested: { secret: '••••' } });
  });
});
