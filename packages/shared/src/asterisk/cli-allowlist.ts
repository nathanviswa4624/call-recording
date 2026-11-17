/**
 * Asterisk CLI allowlist (docs/08 §6). Enforced by the connector AND the backend.
 * Anything not matched is rejected. There is no shell access path.
 */

export type CliTier = 'read' | 'active';

export interface CliCommandSpec {
  id: string;
  tier: CliTier;
  pattern: RegExp;
  /** Example / template for the UI "safe commands" list. */
  example: string;
  description: string;
}

const ARG = '[A-Za-z0-9_.@/\\-]{1,80}';
const RELOADABLE_MODULES = '(res_pjsip\\.so|res_pjsip_outbound_registration\\.so|res_pjsip_endpoint_identifier_ip\\.so|pbx_config\\.so|cdr_adaptive_odbc\\.so|cel_odbc\\.so|res_odbc\\.so|res_musiconhold\\.so|app_queue\\.so|res_ari\\.so|manager)';

export const CLI_COMMANDS: readonly CliCommandSpec[] = [
  { id: 'core.version', tier: 'read', pattern: /^core show version$/, example: 'core show version', description: 'Asterisk version' },
  { id: 'core.uptime', tier: 'read', pattern: /^core show uptime( seconds)?$/, example: 'core show uptime', description: 'Uptime and last reload' },
  { id: 'core.channels', tier: 'read', pattern: /^core show channels( (concise|verbose|count))?$/, example: 'core show channels', description: 'Active channels' },
  { id: 'core.channel', tier: 'read', pattern: new RegExp(`^core show channel ${ARG}$`), example: 'core show channel PJSIP/AVAYA-00000001', description: 'Channel details' },
  { id: 'core.calls', tier: 'read', pattern: /^core show calls( (uptime|seconds))?$/, example: 'core show calls', description: 'Active calls' },
  { id: 'core.settings', tier: 'read', pattern: /^core show (settings|sysinfo|threads|taskprocessors)$/, example: 'core show settings', description: 'Core settings' },
  { id: 'pjsip.show', tier: 'read', pattern: /^pjsip show (endpoints|aors|auths|contacts|registrations|transports|identifies|channels|channelstats|version|settings|unidentified_requests)$/, example: 'pjsip show endpoints', description: 'PJSIP object lists' },
  { id: 'pjsip.show.one', tier: 'read', pattern: new RegExp(`^pjsip show (endpoint|aor|auth|contact|registration|transport|identify|qualify) ${ARG}$`), example: 'pjsip show endpoint AVAYA', description: 'One PJSIP object' },
  { id: 'pjsip.list', tier: 'read', pattern: /^pjsip list (endpoints|contacts|aors|auths|transports|identifies|registrations|ciphers)$/, example: 'pjsip list endpoints', description: 'PJSIP compact lists' },
  { id: 'dialplan.show', tier: 'read', pattern: new RegExp(`^dialplan show( ${ARG})?$`), example: 'dialplan show from-avaya', description: 'Dialplan contexts' },
  { id: 'module.show', tier: 'read', pattern: new RegExp(`^module show( like ${ARG})?$`), example: 'module show like pjsip', description: 'Loaded modules' },
  { id: 'bridge.show', tier: 'read', pattern: new RegExp(`^bridge show (all|${ARG})$`), example: 'bridge show all', description: 'Bridges' },
  { id: 'status.misc', tier: 'read', pattern: /^(cdr show status|cel show status|manager show connected|ari show apps|odbc show( all)?|logger show channels|sorcery memory cache (show|stats) [A-Za-z0-9_\-]{1,40})$/, example: 'cdr show status', description: 'Subsystem status' },
  { id: 'rtp.settings', tier: 'read', pattern: /^rtp show settings$/, example: 'rtp show settings', description: 'RTP port range / settings' },
  // ---- active (super admin only) ----
  { id: 'pjsip.reload', tier: 'active', pattern: /^pjsip reload$/, example: 'pjsip reload', description: 'Reload PJSIP' },
  { id: 'module.reload', tier: 'active', pattern: new RegExp(`^module reload ${RELOADABLE_MODULES}$`), example: 'module reload res_pjsip.so', description: 'Reload an allowed module' },
  { id: 'dialplan.reload', tier: 'active', pattern: /^dialplan reload$/, example: 'dialplan reload', description: 'Reload dialplan' },
  { id: 'pjsip.qualify', tier: 'active', pattern: new RegExp(`^pjsip qualify ${ARG}$`), example: 'pjsip qualify AVAYA', description: 'Send OPTIONS to endpoint contacts' },
  { id: 'pjsip.register', tier: 'active', pattern: new RegExp(`^pjsip send (register|unregister) ${ARG}$`), example: 'pjsip send register MITEL-reg', description: 'Force (un)registration' },
  { id: 'core.restart', tier: 'active', pattern: /^core restart (gracefully|when convenient)$/, example: 'core restart gracefully', description: 'Restart Asterisk safely' },
];

const FORBIDDEN_CHARS = /[;|&$`<>\\!\r\n\0"'{}]/;

export type CliCheck =
  | { allowed: true; command: string; spec: CliCommandSpec }
  | { allowed: false; reason: string };

export function checkCliCommand(input: string, allowActive: boolean): CliCheck {
  const command = input.trim().replace(/\s+/g, ' ');
  if (!command) return { allowed: false, reason: 'Empty command' };
  if (command.length > 200) return { allowed: false, reason: 'Command too long' };
  if (FORBIDDEN_CHARS.test(command)) return { allowed: false, reason: 'Command contains forbidden characters' };
  const spec = CLI_COMMANDS.find((c) => c.pattern.test(command));
  if (!spec) return { allowed: false, reason: 'Command is not in the allowlist' };
  if (spec.tier === 'active' && !allowActive) return { allowed: false, reason: 'This command requires the cli.unsafe permission' };
  return { allowed: true, command, spec };
}
