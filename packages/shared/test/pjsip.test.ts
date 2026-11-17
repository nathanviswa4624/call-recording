import { describe, expect, it } from 'vitest';
import { composeTrunkObjects } from '../src/pjsip/trunk.js';
import { isIpOrCidr, toAsteriskValue, validatePjsipObject, validateReferences } from '../src/pjsip/validate.js';
import { findOption, optionsFor } from '../src/pjsip/catalog.js';

describe('catalog', () => {
  it('filters options by Asterisk version', () => {
    const v18 = optionsFor('identify', 18).map((o) => o.name);
    const v20 = optionsFor('identify', 20).map((o) => o.name);
    expect(v18).not.toContain('match_request_uri');
    expect(v20).toContain('match_request_uri');
    expect(optionsFor('endpoint', 20).map((o) => o.name)).not.toContain('stir_shaken');
  });
});

describe('validatePjsipObject', () => {
  it('accepts a valid endpoint', () => {
    expect(validatePjsipObject('endpoint', 'AVAYA-PBX', { transport: 'transport-tcp', context: 'from-avaya', direct_media: false, dtmf_mode: 'rfc4733', allow: 'ulaw,alaw' }, { asteriskMajor: 22 })).toEqual([]);
  });
  it('flags unknown, unsupported and invalid values', () => {
    const issues = validatePjsipObject('endpoint', 'bad name!', { foo_bar: 'x', dtmf_mode: 'pulse', security_negotiation: 'mediasec', context: 'a\nb' }, { asteriskMajor: 18 });
    const codes = issues.map((i) => `${i.field}:${i.code}`);
    expect(codes).toContain('name:INVALID_VALUE');
    expect(codes).toContain('foo_bar:UNKNOWN_PARAMETER');
    expect(codes).toContain('dtmf_mode:INVALID_VALUE');
    expect(codes).toContain('security_negotiation:UNSUPPORTED_PARAMETER');
    expect(codes).toContain('context:INVALID_VALUE');
  });
  it('downgrades unknown to warning in non-strict mode', () => {
    const issues = validatePjsipObject('endpoint', 'x', { future_option: 'y' }, { asteriskMajor: 22, strictCatalog: false });
    expect(issues[0]?.severity).toBe('warning');
  });
  it('requires identify match and auth password', () => {
    expect(validatePjsipObject('identify', 'i', { endpoint: 'e' }, { asteriskMajor: 20 }).map((i) => i.code)).toContain('REQUIRED');
    expect(validatePjsipObject('auth', 'a', { auth_type: 'userpass', username: 'u' }, { asteriskMajor: 20 }).map((i) => i.code)).toContain('REQUIRED');
  });
  it('validates IP/CIDR', () => {
    expect(isIpOrCidr('192.168.51.0/24')).toBe(true);
    expect(isIpOrCidr('192.168.51.10')).toBe(true);
    expect(isIpOrCidr('192.168.51.0/33')).toBe(false);
    expect(isIpOrCidr('300.1.1.1')).toBe(false);
    expect(isIpOrCidr('fd00::/8')).toBe(true);
  });
  it('converts booleans to yes/no', () => {
    expect(toAsteriskValue(findOption('endpoint', 'direct_media'), false)).toBe('no');
    expect(toAsteriskValue(findOption('endpoint', 'direct_media'), 'true')).toBe('yes');
  });
});

describe('composeTrunkObjects', () => {
  it('builds the Avaya IP-based trunk from the spec', () => {
    const objs = composeTrunkObjects({
      name: 'AVAYA-PBX', host: '192.168.51.10', port: 5060, protocol: 'tcp', transport: 'transport-tcp',
      authMode: 'IP', sipMode: 'PEER', inboundContext: 'from-avaya', remoteDomain: '192.168.51.10',
      matchNetworks: ['192.168.51.0/24'],
    });
    expect(objs.map((o) => `${o.type}:${o.name}`)).toEqual(['aor:AVAYA-PBX', 'endpoint:AVAYA-PBX', 'identify:AVAYA-PBX']);
    const aor = objs.find((o) => o.type === 'aor')!;
    expect(aor.params['contact']).toBe('sip:192.168.51.10:5060;transport=tcp');
    const ident = objs.find((o) => o.type === 'identify')!;
    expect(ident.params['match']).toBe('192.168.51.10,192.168.51.0/24');
    const ep = objs.find((o) => o.type === 'endpoint')!;
    expect(ep.params).toMatchObject({ context: 'from-avaya', transport: 'transport-tcp', aors: 'AVAYA-PBX', from_domain: '192.168.51.10' });
    expect(validateReferences([...objs, { type: 'transport', name: 'transport-tcp', params: { protocol: 'tcp', bind: '0.0.0.0:5060' } }])).toEqual([]);
    // Regression (found by the Increment 2 end-to-end run): every generated object of a
    // TCP/TLS trunk must pass validation — the AOR contact contains ";transport=tcp".
    for (const o of objs) expect(validatePjsipObject(o.type, o.name, o.params, { asteriskMajor: 22 }), `${o.type}:${o.name}`).toEqual([]);
  });

  it('adds auth + registration and honours overrides', () => {
    const objs = composeTrunkObjects({
      name: 'MITEL', host: 'pbx.example.com', port: 5060, protocol: 'udp', transport: 'transport-udp',
      authMode: 'USERPASS', sipMode: 'REGISTER_OUTBOUND', username: 'rec', password: 's3cret', inboundContext: 'from-mitel',
      template: { endpoint: { allow: 'alaw' } }, overrides: { endpoint: { dtmf_mode: 'info' } },
    });
    expect(objs.map((o) => o.type)).toEqual(['aor', 'auth', 'endpoint', 'identify', 'registration']);
    const ep = objs.find((o) => o.type === 'endpoint')!;
    expect(ep.params).toMatchObject({ allow: 'alaw', dtmf_mode: 'info', outbound_auth: 'MITEL-auth' });
    const reg = objs.find((o) => o.type === 'registration')!;
    expect(reg.params).toMatchObject({ server_uri: 'sip:pbx.example.com:5060', client_uri: 'sip:rec@pbx.example.com', outbound_auth: 'MITEL-auth' });
    for (const o of objs) {
      if (o.type === 'transport') continue;
      expect(validatePjsipObject(o.type, o.name, o.params, { asteriskMajor: 22 })).toEqual([]);
    }
  });

  it('detects missing references and identify conflicts', () => {
    const issues = validateReferences([
      { type: 'endpoint', name: 'A', params: { transport: 'nope', aors: 'A' } },
      { type: 'identify', name: 'A', params: { endpoint: 'A', match: '10.0.0.1' } },
      { type: 'endpoint', name: 'B', params: {} },
      { type: 'identify', name: 'B', params: { endpoint: 'B', match: '10.0.0.1' } },
    ]);
    expect(issues.map((i) => `${i.object}:${i.code}`)).toEqual(expect.arrayContaining(['A:MISSING_REFERENCE', 'B:CONFLICT']));
  });
});
