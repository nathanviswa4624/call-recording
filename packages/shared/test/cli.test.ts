import { describe, expect, it } from 'vitest';
import { checkCliCommand } from '../src/asterisk/cli-allowlist.js';

describe('CLI allowlist', () => {
  it('allows read commands', () => {
    for (const c of ['pjsip show endpoints', 'pjsip show endpoint AVAYA', 'core show channels', 'core  show   calls', 'dialplan show from-avaya', 'pjsip show registrations', 'pjsip show transports']) {
      expect(checkCliCommand(c, false).allowed, c).toBe(true);
    }
  });
  it('gates active commands', () => {
    expect(checkCliCommand('pjsip reload', false).allowed).toBe(false);
    expect(checkCliCommand('pjsip reload', true).allowed).toBe(true);
    expect(checkCliCommand('core restart gracefully', true).allowed).toBe(true);
  });
  it('rejects dangerous or unknown commands', () => {
    for (const c of ['core stop now', 'core restart now', '!ls', 'module unload res_pjsip.so', 'pjsip show endpoint A; core stop now', 'originate Local/1@x application Playback x', 'database deltree /', 'module reload app_system.so', 'dialplan show $(id)', 'pjsip show endpoint a\ncore stop now']) {
      expect(checkCliCommand(c, true).allowed, c).toBe(false);
    }
  });
});
