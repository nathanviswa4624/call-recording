/**
 * Dialplan compiler: turns PBX/trunk/route/policy/custom-context data into the
 * text of extensions_echelons.conf. See docs/06-call-flow.md and docs/07.
 *
 * Design rules:
 *  - Route priority is honoured via ordered `include =>` of one context per
 *    priority tier; inside a tier Asterisk's specificity ordering applies, which
 *    is what `selectRoute()` in routing/pattern.ts reproduces.
 *  - Every value embedded in the output is validated or sanitised; no user text
 *    can introduce a new line, section or comment.
 *  - Output is deterministic (stable sort) so its hash identifies a configuration.
 */
import { compilePattern, toDialplanPattern } from '../routing/pattern.js';

export type RecordingMode = 'NEVER' | 'ALWAYS' | 'INBOUND_ONLY' | 'OUTBOUND_ONLY' | 'ON_DEMAND';
export type RecordingLayout = 'MIXED' | 'MIXED_AND_SPLIT';
export type RecordingFormat = 'wav' | 'wav49' | 'gsm';
export type RouteDirection = 'INBOUND' | 'OUTBOUND' | 'INTERNAL' | 'TRANSIT';

export interface RecordingPolicyInput {
  mode: RecordingMode;
  layout: RecordingLayout;
  format: RecordingFormat;
}

export type RouteEgress =
  | { kind: 'TRUNK'; endpointName: string }
  | { kind: 'CONTEXT'; context: string }
  | { kind: 'HANGUP'; cause?: number };

export interface RoutePatternInput {
  id: string;
  pattern: string;
  prefix?: string | null;
  stripDigits?: number | null;
  prepend?: string | null;
  enabled?: boolean;
  recordingPolicy?: RecordingPolicyInput | null;
}

export interface RouteInput {
  id: string;
  name: string;
  /** The PBX whose inbound trunk context will consult this route table. */
  pbxId: string;
  priority: number;
  direction: RouteDirection;
  enabled?: boolean;
  egress: RouteEgress;
  recordingPolicy: RecordingPolicyInput;
  callerIdNumber?: string | null;
  callerIdName?: string | null;
  dialTimeout?: number | null;
  dialOptions?: string | null;
  patterns: RoutePatternInput[];
}

export interface PbxInput {
  id: string;
  /** Short identifier used in context names and recording paths. */
  code: string;
}

export interface TrunkInput {
  id: string;
  pbxId: string;
  endpointName: string;
  inboundContext: string;
  enabled?: boolean;
}

export interface CustomPriority {
  app: string;
  args?: string;
  label?: string;
}
export interface CustomExtension {
  exten: string;
  priorities: CustomPriority[];
}
export interface CustomContext {
  name: string;
  includes?: string[];
  extensions: CustomExtension[];
}

export interface DialplanCompileInput {
  version: number;
  serverId: string;
  recordingBasePath: string;
  pbxs: PbxInput[];
  trunks: TrunkInput[];
  routes: RouteInput[];
  contexts?: CustomContext[];
}

export interface CompileIssue {
  severity: 'error' | 'warning';
  object: string;
  message: string;
}

export interface DialplanCompileResult {
  text: string;
  issues: CompileIssue[];
  contexts: string[];
}

/** Applications allowed in the web dialplan editor. */
export const ALLOWED_APPLICATIONS = [
  'Answer', 'Progress', 'Ringing', 'NoOp', 'Set', 'Goto', 'GotoIf', 'GotoIfTime', 'Gosub', 'GosubIf', 'Return',
  'Dial', 'Queue', 'MixMonitor', 'StopMixMonitor', 'Playback', 'Background', 'WaitExten', 'Wait', 'Hangup',
  'Congestion', 'Busy', 'ExecIf', 'Log', 'Verbose', 'ConfBridge', 'VoiceMail', 'Read', 'SayDigits',
  'PlayTones', 'StopPlayTones', 'Echo', 'Stasis', 'UserEvent', 'CELGenUserEvent', 'Transfer', 'SIPAddHeader',
] as const;

export const RESERVED_CONTEXT_PREFIX = 'ech-';

const CTX_RE = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,31}$/;
const ID_RE = /^[A-Za-z0-9\-]{1,64}$/;
const DIAL_OPTS_RE = /^[A-Za-z0-9()^]*$/;
const LABEL_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const LITERAL_EXTEN_RE = /^[0-9A-Za-z*#+]{1,80}$/;

/** Escape text for an application-argument position in extensions.conf. */
export function escapeAppArgs(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error('application arguments may not contain line breaks');
  return s.replace(/;/g, '\\;');
}

export function resolveRecordingCode(policy: RecordingPolicyInput, direction: RouteDirection): string {
  let mode: 'ALWAYS' | 'NEVER' | 'ON_DEMAND';
  switch (policy.mode) {
    case 'ALWAYS': mode = 'ALWAYS'; break;
    case 'NEVER': mode = 'NEVER'; break;
    case 'ON_DEMAND': mode = 'ON_DEMAND'; break;
    case 'INBOUND_ONLY': mode = direction === 'INBOUND' ? 'ALWAYS' : 'NEVER'; break;
    case 'OUTBOUND_ONLY': mode = direction === 'OUTBOUND' ? 'ALWAYS' : 'NEVER'; break;
  }
  return `${mode}:${policy.layout}:${policy.format}`;
}

export function routeTableContext(pbx: PbxInput): string {
  return `ech-routes-${pbx.code.toLowerCase()}`;
}

function tierContext(pbx: PbxInput, priority: number): string {
  return `${routeTableContext(pbx)}-p${String(priority).padStart(4, '0')}`;
}

function staticContexts(recordingBasePath: string): string {
  const root = recordingBasePath.replace(/\/+$/, '');
  return `[ech-route-apply]
; ARG1=route id, ARG2=route pattern id, ARG3=direction, ARG4=recording policy code
exten => s,1,Set(__ECH_ROUTE_ID=\${ARG1})
 same => n,Set(__ECH_ROUTE_PATTERN_ID=\${ARG2})
 same => n,Set(__ECH_DIRECTION=\${ARG3})
 same => n,Set(CDR(ech_route_id)=\${ARG1})
 same => n,Set(CDR(ech_route_pattern_id)=\${ARG2})
 same => n,Set(CDR(ech_direction)=\${ARG3})
 same => n,Set(CDR(ech_dialed)=\${ECH_DIALED})
 same => n,Gosub(ech-record,s,1(\${ARG4}))
 same => n,Return()

[ech-record]
; ARG1=MODE:LAYOUT:FORMAT
exten => s,1,Set(ECH_REC_MODE=\${CUT(ARG1,:,1)})
 same => n,Set(ECH_REC_LAYOUT=\${CUT(ARG1,:,2)})
 same => n,Set(ECH_REC_FMT=\${CUT(ARG1,:,3)})
 same => n,Set(CDR(ech_rec_policy)=\${ARG1})
 same => n,ExecIf($["\${ECH_REC_MODE}" = "ON_DEMAND"]?Set(ECH_DIAL_OPTS=\${ECH_DIAL_OPTS}xX))
 same => n,GotoIf($["\${ECH_REC_MODE}" != "ALWAYS"]?done)
 same => n,GotoIf($["\${ECH_REC_FILE}" != ""]?done)
 same => n,Set(ECH_TS=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)})
 same => n,Set(__ECH_REC_FILE=\${STRFTIME(\${EPOCH},,%Y/%m/%d)}/\${ECH_PBX_CODE}/\${ECH_TS}_\${FILTER(0-9+,\${CALLERID(num)})}_\${FILTER(0-9+*#,\${ECH_NUM})}_\${ECH_DIRECTION})
 same => n,Set(CDR(ech_rec_file)=\${ECH_REC_FILE})
 same => n,Set(CDR(ech_rec_format)=\${ECH_REC_FMT})
 same => n,GotoIf($["\${ECH_REC_LAYOUT}" = "MIXED_AND_SPLIT"]?split)
 same => n,MixMonitor(${root}/\${ECH_REC_FILE}.\${ECH_REC_FMT},b)
 same => n,Goto(done)
 same => n(split),MixMonitor(${root}/\${ECH_REC_FILE}.\${ECH_REC_FMT},br(${root}/\${ECH_REC_FILE}-caller.\${ECH_REC_FMT})t(${root}/\${ECH_REC_FILE}-callee.\${ECH_REC_FMT}))
 same => n(done),Return()

[ech-test]
; connectivity test calls (AMI Originate from the connector)
exten => s,1,Answer()
 same => n,Playback(beep)
 same => n,Wait(1)
 same => n,Hangup()
`;
}

export function compileDialplan(input: DialplanCompileInput): DialplanCompileResult {
  const issues: CompileIssue[] = [];
  const out: string[] = [];
  const contextNames: string[] = [];
  const err = (object: string, message: string) => issues.push({ severity: 'error', object, message });
  const warn = (object: string, message: string) => issues.push({ severity: 'warning', object, message });

  if (!/^\/[A-Za-z0-9_.\/\-]+$/.test(input.recordingBasePath) || input.recordingBasePath.includes('..')) {
    err('recordingBasePath', 'must be an absolute path of letters, digits, _ . - /');
  }

  const pbxById = new Map(input.pbxs.map((p) => [p.id, p]));
  for (const p of input.pbxs) {
    if (!CODE_RE.test(p.code)) err(`pbx:${p.id}`, `PBX code "${p.code}" must match ${CODE_RE}`);
  }
  const codes = new Set<string>();
  for (const p of input.pbxs) {
    const c = p.code.toLowerCase();
    if (codes.has(c)) err(`pbx:${p.id}`, `duplicate PBX code "${p.code}"`);
    codes.add(c);
  }

  out.push(`; ===== generated by the call recording platform — config version ${input.version} =====`);
  out.push('; DO NOT EDIT: changes are overwritten on the next apply. Edit through the web UI.');
  out.push(`; server ${input.serverId}`);
  out.push('');
  out.push(staticContexts(input.recordingBasePath));
  contextNames.push('ech-route-apply', 'ech-record', 'ech-test');

  // --- trunk inbound contexts -------------------------------------------------
  const trunks = input.trunks.filter((t) => t.enabled !== false).sort((a, b) => a.inboundContext.localeCompare(b.inboundContext));
  const inboundSeen = new Map<string, string>();
  for (const t of trunks) {
    const pbx = pbxById.get(t.pbxId);
    if (!pbx) { err(`trunk:${t.endpointName}`, 'references an unknown PBX'); continue; }
    if (!CTX_RE.test(t.inboundContext)) { err(`trunk:${t.endpointName}`, `invalid inbound context "${t.inboundContext}"`); continue; }
    if (t.inboundContext.startsWith(RESERVED_CONTEXT_PREFIX)) { err(`trunk:${t.endpointName}`, `context names starting with "${RESERVED_CONTEXT_PREFIX}" are reserved`); continue; }
    if (!ID_RE.test(t.id) || !ID_RE.test(pbx.id)) { err(`trunk:${t.endpointName}`, 'invalid identifier'); continue; }
    const prev = inboundSeen.get(t.inboundContext);
    if (prev) {
      if (prev !== t.pbxId) err(`trunk:${t.endpointName}`, `inbound context "${t.inboundContext}" is shared with a trunk of another PBX`);
      else warn(`trunk:${t.endpointName}`, `inbound context "${t.inboundContext}" shared with another trunk of the same PBX; trunk id will be taken from the first one`);
      continue;
    }
    inboundSeen.set(t.inboundContext, t.pbxId);
    const table = routeTableContext(pbx);
    contextNames.push(t.inboundContext);
    out.push(`[${t.inboundContext}]`);
    out.push(`; inbound from trunk ${t.endpointName} (PBX ${pbx.code})`);
    for (const ext of ['_[0-9*#+a-zA-Z]', '_[0-9*#+a-zA-Z].']) {
      out.push(`exten => ${ext},1,NoOp(Inbound from ${pbx.code} via ${t.endpointName} to \${EXTEN})`);
      out.push(` same => n,Set(__ECH_PBX_ID=${pbx.id})`);
      out.push(` same => n,Set(__ECH_PBX_CODE=${pbx.code})`);
      out.push(` same => n,Set(__ECH_TRUNK_ID=${t.id})`);
      out.push(` same => n,Set(__ECH_SERVER_ID=${input.serverId})`);
      out.push(` same => n,Set(ECH_DIALED=\${EXTEN})`);
      out.push(' same => n,Set(ECH_DIAL_OPTS=)');
      out.push(` same => n,Set(CDR(ech_pbx_id)=\${ECH_PBX_ID})`);
      out.push(` same => n,Set(CDR(ech_trunk_id)=\${ECH_TRUNK_ID})`);
      out.push(` same => n,Set(CDR(ech_server_id)=\${ECH_SERVER_ID})`);
      out.push(' same => n,Set(CDR(sip_callid)=${CHANNEL(pjsip,call-id)})');
      out.push(' same => n,Set(CDR(peer_ip)=${CHANNEL(pjsip,remote_addr)})');
      out.push(' same => n,Set(CDR(user_agent)=${PJSIP_HEADER(read,User-Agent)})');
      out.push(` same => n,GotoIf($[\${DIALPLAN_EXISTS(${table},\${EXTEN},1)}]?${table},\${EXTEN},1)`);
      out.push(' same => n,Set(CDR(ech_direction)=UNROUTED)');
      out.push(' same => n,Hangup(1)');
    }
    out.push('');
  }

  // --- route tables ----------------------------------------------------------
  const routesByPbx = new Map<string, RouteInput[]>();
  for (const r of input.routes.filter((x) => x.enabled !== false)) {
    if (!pbxById.has(r.pbxId)) { err(`route:${r.name}`, 'references an unknown PBX'); continue; }
    const list = routesByPbx.get(r.pbxId) ?? [];
    list.push(r);
    routesByPbx.set(r.pbxId, list);
  }

  for (const pbx of [...input.pbxs].sort((a, b) => a.code.localeCompare(b.code))) {
    const routes = (routesByPbx.get(pbx.id) ?? []).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    const table = routeTableContext(pbx);
    const tiers = [...new Set(routes.map((r) => r.priority))];
    contextNames.push(table);
    out.push(`[${table}]`);
    out.push(`; route table for PBX ${pbx.code}: tiers searched in priority order`);
    for (const p of tiers) out.push(`include => ${tierContext(pbx, p)}`);
    out.push('');

    for (const prio of tiers) {
      const ctx = tierContext(pbx, prio);
      contextNames.push(ctx);
      out.push(`[${ctx}]`);
      const seenPatterns = new Map<string, string>();
      for (const r of routes.filter((x) => x.priority === prio)) {
        if (!ID_RE.test(r.id)) { err(`route:${r.name}`, 'invalid route id'); continue; }
        if (r.callerIdNumber && !/^\+?[0-9]{1,32}$/.test(r.callerIdNumber)) err(`route:${r.name}`, 'caller ID number must be digits');
        if (r.callerIdName && /["\r\n;<>]/.test(r.callerIdName)) err(`route:${r.name}`, 'caller ID name contains invalid characters');
        if (r.dialOptions && !DIAL_OPTS_RE.test(r.dialOptions)) err(`route:${r.name}`, 'dial options contain invalid characters');
        const timeout = r.dialTimeout ?? 60;
        if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) err(`route:${r.name}`, 'dial timeout must be 1..3600');
        if (r.egress.kind === 'TRUNK' && !CTX_RE.test(r.egress.endpointName)) err(`route:${r.name}`, 'invalid egress endpoint');
        if (r.egress.kind === 'CONTEXT' && !CTX_RE.test(r.egress.context)) err(`route:${r.name}`, 'invalid egress context');

        for (const pat of r.patterns.filter((x) => x.enabled !== false)) {
          const prefix = pat.prefix ?? '';
          if (prefix && !LITERAL_EXTEN_RE.test(prefix)) { err(`pattern:${pat.pattern}`, 'prefix must be literal digits'); continue; }
          let dpPattern: string;
          try {
            dpPattern = toDialplanPattern(`${prefix}${pat.pattern.replace(/^_/, '')}`);
          } catch (e) {
            err(`pattern:${pat.pattern}`, (e as Error).message);
            continue;
          }
          const strip = prefix.length + (pat.stripDigits ?? 0);
          const prepend = pat.prepend ?? '';
          if (!/^[0-9*#+]*$/.test(prepend)) { err(`pattern:${pat.pattern}`, 'prepend must be digits, *, # or +'); continue; }
          if (!Number.isInteger(strip) || strip < 0 || strip > 40) { err(`pattern:${pat.pattern}`, 'strip digits must be 0..40'); continue; }
          if (compilePattern(dpPattern).minLength <= strip && r.egress.kind !== 'HANGUP') {
            warn(`pattern:${pat.pattern}`, 'stripping removes every digit for the shortest match');
          }
          const dup = seenPatterns.get(dpPattern);
          if (dup) { err(`pattern:${pat.pattern}`, `duplicate pattern ${dpPattern} in priority ${prio} (also in route "${dup}")`); continue; }
          seenPatterns.set(dpPattern, r.name);
          if (!ID_RE.test(pat.id)) { err(`pattern:${pat.pattern}`, 'invalid pattern id'); continue; }

          const recCode = resolveRecordingCode(pat.recordingPolicy ?? r.recordingPolicy, r.direction);
          out.push(`; route "${r.name.replace(/[\r\n;]/g, ' ')}" pattern ${dpPattern}`);
          out.push(`exten => ${dpPattern},1,Set(ECH_NUM=${prepend}\${EXTEN:${strip}})`);
          out.push(` same => n,Gosub(ech-route-apply,s,1(${r.id},${pat.id},${r.direction},${recCode}))`);
          if (r.callerIdNumber) out.push(` same => n,Set(CALLERID(num)=${r.callerIdNumber})`);
          if (r.callerIdName) out.push(` same => n,Set(CALLERID(name)=${r.callerIdName})`);
          switch (r.egress.kind) {
            case 'TRUNK':
              out.push(` same => n,Dial(PJSIP/\${ECH_NUM}@${r.egress.endpointName},${timeout},\${ECH_DIAL_OPTS}${r.dialOptions ?? ''})`);
              out.push(' same => n,Set(CDR(ech_dialstatus)=${DIALSTATUS})');
              out.push(' same => n,Hangup()');
              break;
            case 'CONTEXT':
              out.push(` same => n,Goto(${r.egress.context},\${ECH_NUM},1)`);
              break;
            case 'HANGUP':
              out.push(` same => n,Hangup(${Number.isInteger(r.egress.cause) ? r.egress.cause : 21})`);
              break;
          }
        }
      }
      out.push('');
    }
  }

  // --- custom contexts (web dialplan editor) ----------------------------------
  const generated = new Set(contextNames);
  for (const c of [...(input.contexts ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!CTX_RE.test(c.name)) { err(`context:${c.name}`, 'invalid context name'); continue; }
    if (c.name.startsWith(RESERVED_CONTEXT_PREFIX)) { err(`context:${c.name}`, `"${RESERVED_CONTEXT_PREFIX}" prefix is reserved`); continue; }
    if (generated.has(c.name)) { err(`context:${c.name}`, 'name collides with a generated context (e.g. a trunk inbound context)'); continue; }
    generated.add(c.name);
    contextNames.push(c.name);
    out.push(`[${c.name}]`);
    for (const inc of c.includes ?? []) {
      if (!CTX_RE.test(inc)) { err(`context:${c.name}`, `invalid include "${inc}"`); continue; }
      out.push(`include => ${inc}`);
    }
    for (const e of c.extensions) {
      const isPattern = e.exten.startsWith('_');
      if (isPattern) {
        try { compilePattern(e.exten); } catch (ex) { err(`context:${c.name}`, (ex as Error).message); continue; }
      } else if (!LITERAL_EXTEN_RE.test(e.exten)) {
        err(`context:${c.name}`, `invalid extension "${e.exten}"`);
        continue;
      }
      if (e.priorities.length === 0) { err(`context:${c.name}/${e.exten}`, 'extension has no priorities'); continue; }
      e.priorities.forEach((p, i) => {
        if (!(ALLOWED_APPLICATIONS as readonly string[]).includes(p.app)) {
          err(`context:${c.name}/${e.exten}`, `application "${p.app}" is not allowed`);
          return;
        }
        if (p.label && !LABEL_RE.test(p.label)) {
          err(`context:${c.name}/${e.exten}`, `invalid label "${p.label}"`);
          return;
        }
        let args: string;
        try { args = escapeAppArgs(p.args ?? ''); } catch (ex) { err(`context:${c.name}/${e.exten}`, (ex as Error).message); return; }
        const prio = i === 0 ? '1' : 'n';
        const label = p.label ? `(${p.label})` : '';
        const line = `${p.app}(${args})`;
        out.push(i === 0 ? `exten => ${e.exten},${prio}${label},${line}` : ` same => ${prio}${label},${line}`);
      });
    }
    out.push('');
  }

  return { text: out.join('\n'), issues, contexts: contextNames };
}
