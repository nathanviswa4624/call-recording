/**
 * Seed vendor trunk templates. These are inserted into `trunk_templates` on
 * install and are fully editable afterwards — they are starting points, not rules.
 * Vendor deployments differ; nothing here is applied without the admin seeing it.
 */
import type { TrunkTemplateDefaults } from '../pjsip/trunk.js';

export interface VendorTemplateSeed {
  code: string;
  vendor: string;
  name: string;
  description: string;
  defaultProtocol: 'udp' | 'tcp' | 'tls';
  defaultPort: number;
  defaults: TrunkTemplateDefaults;
}

export const VENDOR_TEMPLATES: VendorTemplateSeed[] = [
  {
    code: 'GENERIC_SIP', vendor: 'Generic', name: 'Generic SIP', description: 'RFC 3261 SIP peer, G.711, RFC 4733 DTMF.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw', dtmf_mode: 'rfc4733' } },
  },
  {
    code: 'AVAYA', vendor: 'Avaya', name: 'Avaya Aura / IP Office', description: 'Commonly TCP/TLS with session timers; sends PAI.',
    defaultProtocol: 'tcp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw,g729', timers: 'yes', send_pai: true, trust_id_inbound: true, '100rel': 'peer_supported' } },
  },
  {
    code: 'CISCO', vendor: 'Cisco', name: 'Cisco CUCM / CUBE', description: 'SIP trunk to CUCM/CUBE, RPID/PAI trust.',
    defaultProtocol: 'tcp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw,g729', send_rpid: true, send_pai: true, timers: 'yes', connected_line_method: 'update' } },
  },
  {
    code: 'MITEL', vendor: 'Mitel', name: 'Mitel MiVoice', description: 'MiVoice Business/Connect SIP peer.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw,g729', send_pai: true, dtmf_mode: 'rfc4733' } },
  },
  {
    code: 'ALCATEL', vendor: 'Alcatel-Lucent', name: 'Alcatel-Lucent OXE/OXO', description: 'OmniPCX SIP trunk.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'alaw,ulaw,g729', send_pai: true, timers: 'yes' } },
  },
  {
    code: 'NEC', vendor: 'NEC', name: 'NEC SV9100/SV9500', description: 'NEC Univerge SIP trunk.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw,g729', dtmf_mode: 'rfc4733' } },
  },
  {
    code: 'PANASONIC', vendor: 'Panasonic', name: 'Panasonic KX-NS', description: 'Panasonic SIP trunk.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw,g729', dtmf_mode: 'rfc4733' } },
  },
  {
    code: 'YEASTAR', vendor: 'Yeastar', name: 'Yeastar P-Series / S-Series', description: 'Peer trunk to Yeastar.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw', rewrite_contact: true } },
  },
  {
    code: '3CX', vendor: '3CX', name: '3CX', description: '3CX generic SIP trunk / IP-based.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw', rewrite_contact: true, send_pai: true } },
  },
  {
    code: 'FREEPBX', vendor: 'Sangoma', name: 'FreePBX / Asterisk', description: 'Asterisk-to-Asterisk PJSIP trunk.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw', trust_id_inbound: true, trust_id_outbound: true, send_pai: true } },
  },
  {
    code: 'GENERIC_IPPBX', vendor: 'Generic', name: 'Generic IP-PBX', description: 'Conservative defaults for unknown IP-PBX.',
    defaultProtocol: 'udp', defaultPort: 5060,
    defaults: { endpoint: { allow: 'ulaw,alaw', dtmf_mode: 'auto', rtp_symmetric: true, force_rport: true, rewrite_contact: true } },
  },
];
