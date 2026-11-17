/**
 * Collect the draft configuration of one Asterisk server from the app schema
 * into the plain structures the shared validators/compilers consume.
 */
import type { Prisma } from '@prisma/client';
import type {
  CustomContext, DialplanCompileInput, ParamValue, PjsipObjectRef, RecordingPolicyInput, RouteInput,
} from '@echelons/shared';
import { prisma } from '../../lib/prisma.js';
import { SecretBox } from '../../lib/crypto.js';
import { env } from '../../config/env.js';

export interface DraftState {
  /** Problems detected while collecting (e.g. cross-server references). */
  issues: Array<{ severity: 'error' | 'warning'; object: string; message: string }>;
  objects: PjsipObjectRef[];
  transports: PjsipObjectRef[];
  dialplan: DialplanCompileInput;
}

const asParams = (j: Prisma.JsonValue): Record<string, ParamValue> =>
  j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, ParamValue>) : {};

type PolicyRow = { mode: RecordingPolicyInput['mode']; layout: RecordingPolicyInput['layout']; format: RecordingPolicyInput['format'] } | null;
const toPolicy = (p: PolicyRow): RecordingPolicyInput | null => (p ? { mode: p.mode, layout: p.layout, format: p.format } : null);

export const authAad = (authId: string) => `sip_auth:${authId}`;
export const trunkAad = (trunkId: string) => `sip_trunk:${trunkId}`;

export async function collectDraft(serverId: string, version: number): Promise<DraftState> {
  const box = new SecretBox(env().ENCRYPTION_KEY);
  const server = await prisma.asteriskServer.findUniqueOrThrow({
    where: { id: serverId },
    include: {
      transports: true,
      endpoints: { where: { enabled: true } },
      aors: { include: { contacts: true } },
      auths: true,
      identifies: true,
      registrations: true,
      domainAliases: true,
      globals: true,
      contexts: { where: { readOnly: false }, include: { extensions: { include: { priorities: { orderBy: { position: 'asc' } } }, orderBy: { sortOrder: 'asc' } } } },
    },
  });

  const objects: PjsipObjectRef[] = [];
  for (const e of server.endpoints) objects.push({ type: 'endpoint', name: e.name, params: asParams(e.params) });
  for (const a of server.aors) {
    const params = { ...asParams(a.params) };
    const contacts = a.contacts.map((c) => c.uri);
    if (contacts.length) params['contact'] = [params['contact'], ...contacts].filter(Boolean).join(',');
    objects.push({ type: 'aor', name: a.name, params });
  }
  for (const a of server.auths) {
    const secret = a.secretEnc ? box.decrypt(a.secretEnc, authAad(a.id)) : undefined;
    const params: Record<string, ParamValue> = { ...asParams(a.params), auth_type: a.authType, username: a.username ?? undefined, realm: a.realm ?? undefined };
    if (a.authType === 'md5') params['md5_cred'] = secret;
    else params['password'] = secret;
    objects.push({ type: 'auth', name: a.name, params });
  }
  for (const i of server.identifies) objects.push({ type: 'identify', name: i.name, params: { ...asParams(i.params), endpoint: i.endpointName } });
  for (const r of server.registrations) objects.push({ type: 'registration', name: r.name, params: asParams(r.params) });
  for (const d of server.domainAliases) objects.push({ type: 'domain_alias', name: d.name, params: { domain: d.domain } });
  if (server.globals) objects.push({ type: 'global', name: 'global', params: asParams(server.globals.params) });

  const transports: PjsipObjectRef[] = server.transports.map((t) => ({
    type: 'transport',
    name: t.name,
    params: { ...asParams(t.params), protocol: t.protocol, bind: `${t.bindAddress.includes(':') ? `[${t.bindAddress}]` : t.bindAddress}:${t.bindPort}` },
  }));

  // ---- dialplan input ----
  const pbxs = await prisma.pbx.findMany({
    where: { serverId },
    include: {
      recordingPolicy: true,
      trunks: { include: { recordingPolicy: true } },
      routes: {
        include: {
          recordingPolicy: true,
          egressTrunk: { include: { pbx: { select: { serverId: true } } } },
          patterns: { include: { recordingPolicy: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  const orgDefault = await prisma.recordingPolicy.findFirst({ where: { organizationId: server.organizationId, isDefault: true } });
  const fallback: RecordingPolicyInput = toPolicy(orgDefault) ?? { mode: 'ALWAYS', layout: 'MIXED', format: 'wav' };

  const issues: DraftState['issues'] = [];
  const routes: RouteInput[] = [];
  for (const pbx of pbxs.filter((p) => p.enabled)) {
    const pbxPolicy = toPolicy(pbx.recordingPolicy);
    for (const r of pbx.routes) {
      let egress: RouteInput['egress'];
      if (r.egressKind === 'TRUNK') {
        if (!r.egressTrunk) {
          issues.push({ severity: 'error', object: `route:${r.name}`, message: 'egress trunk is not set' });
          continue;
        }
        if (r.egressTrunk.pbx.serverId !== serverId) {
          issues.push({ severity: 'error', object: `route:${r.name}`, message: `egress trunk "${r.egressTrunk.name}" lives on another Asterisk server` });
          continue;
        }
        egress = { kind: 'TRUNK', endpointName: r.egressTrunk.name };
      } else if (r.egressKind === 'CONTEXT') egress = { kind: 'CONTEXT', context: r.egressContext ?? '' };
      else egress = { kind: 'HANGUP' };
      routes.push({
        id: r.id, name: r.name, pbxId: pbx.id, priority: r.priority, direction: r.direction, enabled: r.enabled,
        egress,
        recordingPolicy: toPolicy(r.recordingPolicy) ?? pbxPolicy ?? fallback,
        callerIdNumber: r.callerIdNumber, callerIdName: r.callerIdName, dialTimeout: r.dialTimeout, dialOptions: r.dialOptions,
        patterns: r.patterns.map((p) => ({
          id: p.id, pattern: p.pattern, prefix: p.prefix, stripDigits: p.stripDigits, prepend: p.prepend, enabled: p.enabled,
          recordingPolicy: toPolicy(p.recordingPolicy),
        })),
      });
    }
  }

  const contexts: CustomContext[] = server.contexts.map((c) => ({
    name: c.name,
    includes: c.includes,
    extensions: c.extensions.map((e) => ({ exten: e.exten, priorities: e.priorities.map((p) => ({ app: p.app, args: p.args, label: p.label ?? undefined })) })),
  }));

  return {
    issues,
    objects,
    transports,
    dialplan: {
      version,
      serverId,
      recordingBasePath: server.recordingBasePath,
      pbxs: pbxs.filter((p) => p.enabled).map((p) => ({ id: p.id, code: p.code })),
      trunks: pbxs.filter((p) => p.enabled).flatMap((p) => p.trunks.map((t) => ({ id: t.id, pbxId: p.id, endpointName: t.name, inboundContext: t.inboundContext, enabled: t.enabled }))),
      routes,
      contexts,
    },
  };
}

/** Compile transports into pjsip_echelons_transports.conf text (docs/05 §4). */
export function compileTransports(transports: PjsipObjectRef[], version: number): string {
  const lines = [`; generated — config version ${version} — DO NOT EDIT`, ''];
  for (const t of [...transports].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`[${t.name}]`, 'type=transport');
    for (const [k, v] of Object.entries(t.params).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined || v === null || v === '') continue;
      const val = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
      if (/[\r\n\0;]/.test(val)) throw new Error(`transport ${t.name}: invalid value for ${k}`);
      lines.push(`${k}=${val}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
