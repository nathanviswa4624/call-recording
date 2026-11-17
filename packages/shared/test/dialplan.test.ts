import { describe, expect, it } from 'vitest';
import { compileDialplan, resolveRecordingCode, type DialplanCompileInput } from '../src/dialplan/compiler.js';

const POLICY = { mode: 'ALWAYS', layout: 'MIXED', format: 'wav' } as const;

function base(): DialplanCompileInput {
  return {
    version: 7,
    serverId: 'srv-1',
    recordingBasePath: '/var/spool/asterisk/recording',
    pbxs: [{ id: 'pbx-avaya', code: 'AVAYA' }],
    trunks: [{ id: 'trk-1', pbxId: 'pbx-avaya', endpointName: 'AVAYA-PBX', inboundContext: 'from-avaya' }],
    routes: [
      {
        id: 'rt-mobile', name: 'Mobile', pbxId: 'pbx-avaya', priority: 10, direction: 'OUTBOUND',
        egress: { kind: 'TRUNK', endpointName: 'CARRIER' }, recordingPolicy: POLICY,
        patterns: [{ id: 'pt-1', pattern: 'XXXXXXXXXX', prefix: '9', stripDigits: 0, prepend: '' }],
      },
      {
        id: 'rt-internal', name: 'Internal', pbxId: 'pbx-avaya', priority: 20, direction: 'INTERNAL',
        egress: { kind: 'CONTEXT', context: 'internal-ext' }, recordingPolicy: { ...POLICY, mode: 'OUTBOUND_ONLY' },
        patterns: [{ id: 'pt-2', pattern: '7XXX' }],
      },
    ],
    contexts: [{ name: 'internal-ext', extensions: [{ exten: '_7XXX', priorities: [{ app: 'NoOp', args: 'Internal; call' }, { app: 'Hangup' }] }] }],
  };
}

describe('compileDialplan', () => {
  it('compiles trunk, route tiers and custom contexts', () => {
    const r = compileDialplan(base());
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.text).toContain('[from-avaya]');
    expect(r.text).toContain('[ech-routes-avaya]\n; route table for PBX AVAYA: tiers searched in priority order\ninclude => ech-routes-avaya-p0010\ninclude => ech-routes-avaya-p0020');
    expect(r.text).toContain('exten => _9XXXXXXXXXX,1,Set(ECH_NUM=${EXTEN:1})');
    expect(r.text).toContain('Gosub(ech-route-apply,s,1(rt-mobile,pt-1,OUTBOUND,ALWAYS:MIXED:wav))');
    expect(r.text).toContain('Dial(PJSIP/${ECH_NUM}@CARRIER,60,${ECH_DIAL_OPTS})');
    expect(r.text).toContain('Gosub(ech-route-apply,s,1(rt-internal,pt-2,INTERNAL,NEVER:MIXED:wav))');
    expect(r.text).toContain('Goto(internal-ext,${ECH_NUM},1)');
    expect(r.text).toContain('MixMonitor(/var/spool/asterisk/recording/${ECH_REC_FILE}.${ECH_REC_FMT},b)');
    expect(r.text).toContain('NoOp(Internal\\; call)');
  });

  it('is deterministic', () => {
    expect(compileDialplan(base()).text).toBe(compileDialplan(base()).text);
  });

  it('rejects duplicates, reserved names, bad apps and injection', () => {
    const input = base();
    input.routes[0]!.patterns.push({ id: 'pt-3', pattern: '_9XXXXXXXXXX' });
    input.contexts!.push({ name: 'ech-evil', extensions: [] });
    input.contexts!.push({ name: 'x', extensions: [{ exten: '1', priorities: [{ app: 'System', args: 'rm -rf /' }] }] });
    input.contexts!.push({ name: 'y', extensions: [{ exten: '1', priorities: [{ app: 'NoOp', args: 'a\n[evil]' }] }] });
    input.routes[0]!.callerIdName = 'x"\n';
    const msgs = compileDialplan(input).issues.filter((i) => i.severity === 'error').map((i) => i.message).join('|');
    expect(msgs).toMatch(/duplicate pattern _9XXXXXXXXXX/);
    expect(msgs).toMatch(/reserved/);
    expect(msgs).toMatch(/"System" is not allowed/);
    expect(msgs).toMatch(/line breaks/);
    expect(msgs).toMatch(/caller ID name/);
  });

  it('resolves direction-dependent policies at compile time', () => {
    expect(resolveRecordingCode({ mode: 'INBOUND_ONLY', layout: 'MIXED_AND_SPLIT', format: 'wav' }, 'INBOUND')).toBe('ALWAYS:MIXED_AND_SPLIT:wav');
    expect(resolveRecordingCode({ mode: 'INBOUND_ONLY', layout: 'MIXED', format: 'wav' }, 'OUTBOUND')).toBe('NEVER:MIXED:wav');
  });
});
