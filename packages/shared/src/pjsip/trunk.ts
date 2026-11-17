/**
 * SIP trunk → PJSIP object composition (docs/05 §3).
 *
 * A trunk is a composite of endpoint + aor + identify (+ auth, + registration).
 * Vendor templates supply defaults (data, not code); admin overrides are applied last.
 */
import type { ParamValue, PjsipObjectRef } from './validate.js';

export type TrunkAuthMode = 'NONE' | 'IP' | 'USERPASS';
export type SipMode = 'PEER' | 'REGISTER_OUTBOUND' | 'ACCEPT_REGISTRATION';
export type SipProtocol = 'udp' | 'tcp' | 'tls';

export interface TrunkTemplateDefaults {
  endpoint?: Record<string, ParamValue>;
  aor?: Record<string, ParamValue>;
  identify?: Record<string, ParamValue>;
  registration?: Record<string, ParamValue>;
}

export interface TrunkDefinition {
  name: string;
  host: string;
  port: number;
  protocol: SipProtocol;
  transport: string;
  authMode: TrunkAuthMode;
  sipMode: SipMode;
  username?: string | null;
  /** Plaintext only in memory during publish; never persisted unencrypted in app schema. */
  password?: string | null;
  realm?: string | null;
  remoteDomain?: string | null;
  inboundContext: string;
  /** Extra source networks to identify this PBX (e.g. 192.168.51.0/24). */
  matchNetworks?: string[];
  qualifyFrequency?: number;
  template?: TrunkTemplateDefaults;
  overrides?: TrunkTemplateDefaults;
}

const BASE_ENDPOINT: Record<string, ParamValue> = {
  disallow: 'all',
  allow: 'ulaw,alaw',
  direct_media: false,
  dtmf_mode: 'rfc4733',
  rtp_symmetric: true,
  force_rport: true,
  rewrite_contact: false,
  trust_id_inbound: true,
  trust_id_outbound: true,
  send_pai: true,
};

function bracketHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function composeTrunkObjects(def: TrunkDefinition): PjsipObjectRef[] {
  const authName = `${def.name}-auth`;
  const regName = `${def.name}-reg`;
  const hostPort = `${bracketHost(def.host)}:${def.port}`;
  const objects: PjsipObjectRef[] = [];
  const usesAuth = def.authMode === 'USERPASS';

  const aorParams: Record<string, ParamValue> = {
    qualify_frequency: def.qualifyFrequency ?? 60,
    ...def.template?.aor,
  };
  if (def.sipMode === 'ACCEPT_REGISTRATION') {
    aorParams['max_contacts'] = aorParams['max_contacts'] ?? 1;
    aorParams['remove_existing'] = aorParams['remove_existing'] ?? true;
  } else {
    aorParams['contact'] = `sip:${hostPort}${def.protocol === 'udp' ? '' : `;transport=${def.protocol}`}`;
  }
  Object.assign(aorParams, def.overrides?.aor);
  objects.push({ type: 'aor', name: def.name, params: aorParams });

  if (usesAuth) {
    objects.push({
      type: 'auth',
      name: authName,
      params: {
        auth_type: 'userpass',
        username: def.username ?? '',
        password: def.password ?? '',
        ...(def.realm ? { realm: def.realm } : {}),
      },
    });
  }

  const endpoint: Record<string, ParamValue> = {
    ...BASE_ENDPOINT,
    ...def.template?.endpoint,
    transport: def.transport,
    context: def.inboundContext,
    aors: def.name,
  };
  if (def.remoteDomain) endpoint['from_domain'] = def.remoteDomain;
  if (usesAuth) {
    endpoint['outbound_auth'] = authName;
    if (def.sipMode === 'ACCEPT_REGISTRATION') endpoint['auth'] = authName;
  }
  Object.assign(endpoint, def.overrides?.endpoint);
  objects.push({ type: 'endpoint', name: def.name, params: endpoint });

  // A registering PBX is identified by its auth username; everything else by source IP.
  if (def.sipMode !== 'ACCEPT_REGISTRATION') {
    const matches = [def.host, ...(def.matchNetworks ?? [])].filter((x, i, a) => x && a.indexOf(x) === i);
    objects.push({
      type: 'identify',
      name: def.name,
      params: { ...def.template?.identify, endpoint: def.name, match: matches.join(','), ...def.overrides?.identify },
    });
  }

  if (def.sipMode === 'REGISTER_OUTBOUND') {
    const domain = def.remoteDomain ?? bracketHost(def.host);
    objects.push({
      type: 'registration',
      name: regName,
      params: {
        retry_interval: 60,
        forbidden_retry_interval: 600,
        expiration: 3600,
        ...def.template?.registration,
        transport: def.transport,
        server_uri: `sip:${hostPort}`,
        client_uri: `sip:${def.username ?? def.name}@${domain}`,
        contact_user: def.username ?? def.name,
        endpoint: def.name,
        line: true,
        ...(usesAuth ? { outbound_auth: authName } : {}),
        ...def.overrides?.registration,
      },
    });
  }
  return objects;
}
