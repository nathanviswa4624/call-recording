import { describe, expect, it } from 'vitest';
import { AmiParser, parseBlock, serializeAction } from '../src/ami/protocol.js';
import { parseVersion } from '../src/probes.js';
import { LiveCalls } from '../src/live.js';

describe('AMI protocol', () => {
  it('parses banner and split chunks', () => {
    const p = new AmiParser();
    expect(p.push('Asterisk Call Manager/9.0.0\r\nResponse: Succ')).toEqual([]);
    const msgs = p.push('ess\r\nActionID: 1\r\nMessage: Authentication accepted\r\n\r\nEvent: FullyBooted\r\n\r\n');
    expect(p.banner).toBe('Asterisk Call Manager/9.0.0');
    expect(msgs).toEqual([
      { Response: 'Success', ActionID: '1', Message: 'Authentication accepted' },
      { Event: 'FullyBooted' },
    ]);
  });
  it('joins repeated Output lines from Command', () => {
    expect(parseBlock('Response: Success\r\nOutput: line 1\r\nOutput: line 2')['Output']).toBe('line 1\nline 2');
  });
  it('rejects header injection', () => {
    expect(() => serializeAction('Command', 'x', { Command: 'core show version\r\nAction: Originate' })).toThrow();
    expect(() => serializeAction('Bad Action', 'x', {})).toThrow();
    expect(serializeAction('Ping', 'id1', {})).toBe('Action: Ping\r\nActionID: id1\r\n\r\n');
  });
  it('parses Asterisk versions', () => {
    expect(parseVersion('Asterisk 22.1.0 built by root @ host on a x86_64 running Linux')).toMatchObject({ major: 22, minor: 1, patch: 0 });
    expect(parseVersion('Asterisk certified/20.7-cert3 built by')).toMatchObject({ major: 20, minor: 7 });
    expect(parseVersion('nonsense')).toBeNull();
  });
});

describe('LiveCalls', () => {
  it('tracks a recorded call lifecycle', () => {
    const live = new LiveCalls();
    const events: string[] = [];
    live.on('call', (e: string) => events.push(e));
    live.handle({ Event: 'Newchannel', Uniqueid: 'u1', Linkedid: 'u1', Channel: 'PJSIP/AVAYA-1', CallerIDNum: '201', Exten: '90501234567', ChannelStateDesc: 'Ring' });
    live.handle({ Event: 'VarSet', Uniqueid: 'u1', Variable: '__ECH_PBX_CODE', Value: 'AVAYA' });
    live.handle({ Event: 'MixMonitorStart', Uniqueid: 'u1' });
    expect(live.snapshot()[0]).toMatchObject({ caller: '201', pbxCode: 'AVAYA', recording: 'ACTIVE' });
    live.handle({ Event: 'Hangup', Uniqueid: 'u1', Cause: '16' });
    expect(live.snapshot()).toEqual([]);
    expect(events).toEqual(['call.started', 'call.updated', 'recording.started', 'call.ended']);
  });
});
