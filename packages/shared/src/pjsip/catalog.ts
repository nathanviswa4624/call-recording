/**
 * PJSIP option catalog with per-version availability.
 *
 * Names are the Asterisk option names, which are also the column names of the
 * Sorcery realtime tables (ps_endpoints, ps_aors, ...). `since`/`removedIn` are
 * Asterisk major versions. The catalog drives: form generation, custom-parameter
 * validation and the "unsupported parameter" check before publishing.
 *
 * Extend this file (not the code paths) when supporting new Asterisk options.
 */

export type PjsipObjectType = 'endpoint' | 'aor' | 'auth' | 'identify' | 'transport' | 'registration' | 'global' | 'domain_alias';

export type OptionType =
  | { t: 'bool' }
  | { t: 'int'; min?: number; max?: number }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'string'; max?: number; pattern?: RegExp }
  | { t: 'list' }          // comma separated names
  | { t: 'codecs' }        // comma separated codec names
  | { t: 'ipList' }        // comma separated IP/CIDR/host
  | { t: 'secret' };

export interface OptionSpec {
  name: string;
  type: OptionType;
  since?: number;
  removedIn?: number;
  /** Shown in the main form rather than "advanced". */
  common?: boolean;
  description?: string;
}

const bool: OptionType = { t: 'bool' };
const str = (max = 255): OptionType => ({ t: 'string', max });
const int = (min?: number, max?: number): OptionType => ({ t: 'int', min, max });
const en = (...values: string[]): OptionType => ({ t: 'enum', values });
const list: OptionType = { t: 'list' };

const ENDPOINT: OptionSpec[] = [
  { name: 'transport', type: str(40), common: true },
  { name: 'context', type: str(80), common: true },
  { name: 'disallow', type: { t: 'codecs' }, common: true },
  { name: 'allow', type: { t: 'codecs' }, common: true },
  { name: 'aors', type: list, common: true },
  { name: 'auth', type: str(40), common: true },
  { name: 'outbound_auth', type: str(40), common: true },
  { name: 'direct_media', type: bool, common: true },
  { name: 'dtmf_mode', type: en('rfc4733', 'inband', 'info', 'auto', 'auto_info'), common: true },
  { name: 'trust_id_inbound', type: bool, common: true },
  { name: 'trust_id_outbound', type: bool, common: true },
  { name: 'send_pai', type: bool, common: true },
  { name: 'send_rpid', type: bool, common: true },
  { name: 'send_diversion', type: bool },
  { name: 'callerid', type: str(120), common: true },
  { name: 'callerid_privacy', type: en('allowed_not_screened', 'allowed_passed_screened', 'allowed_failed_screened', 'allowed', 'prohib_not_screened', 'prohib_passed_screened', 'prohib_failed_screened', 'prohib', 'unavailable') },
  { name: 'callerid_tag', type: str(80) },
  { name: 'language', type: str(20), common: true },
  { name: 't38_udptl', type: bool, common: true },
  { name: 't38_udptl_ec', type: en('none', 'fec', 'redundancy') },
  { name: 't38_udptl_maxdatagram', type: int(0, 65535) },
  { name: 't38_udptl_nat', type: bool },
  { name: 'fax_detect', type: bool },
  { name: 'rtp_symmetric', type: bool, common: true },
  { name: 'rewrite_contact', type: bool, common: true },
  { name: 'force_rport', type: bool, common: true },
  { name: 'media_encryption', type: en('no', 'sdes', 'dtls'), common: true },
  { name: 'media_encryption_optimistic', type: bool },
  { name: 'from_domain', type: str(120), common: true },
  { name: 'from_user', type: str(80), common: true },
  { name: 'contact_user', type: str(80), common: true },
  { name: 'timers', type: en('forced', 'no', 'required', 'yes'), common: true },
  { name: 'timers_min_se', type: int(90) },
  { name: 'timers_sess_expires', type: int(90) },
  { name: 'call_group', type: str(120), common: true },
  { name: 'pickup_group', type: str(120), common: true },
  { name: 'named_call_group', type: str(255) },
  { name: 'named_pickup_group', type: str(255) },
  { name: 'identify_by', type: { t: 'string', max: 80, pattern: /^(username|auth_username|ip|header|request_uri)(,(username|auth_username|ip|header|request_uri))*$/ } },
  { name: 'ice_support', type: bool },
  { name: 'use_avpf', type: bool },
  { name: 'webrtc', type: bool, since: 15 },
  { name: 'moh_suggest', type: str(80) },
  { name: 'mailboxes', type: str(255) },
  { name: 'accountcode', type: str(80) },
  { name: 'set_var', type: str(255) },
  { name: 'rtp_ipv6', type: bool },
  { name: 'rtp_timeout', type: int(0) },
  { name: 'rtp_timeout_hold', type: int(0) },
  { name: 'rtp_keepalive', type: int(0) },
  { name: 'rtp_engine', type: str(40) },
  { name: 'media_address', type: str(80) },
  { name: 'bind_rtp_to_media_address', type: bool },
  { name: 'tos_audio', type: str(10) },
  { name: 'cos_audio', type: int(0, 7) },
  { name: 'inband_progress', type: bool },
  { name: 'allow_transfer', type: bool },
  { name: 'allow_subscribe', type: bool },
  { name: 'allow_overlap', type: bool },
  { name: 'aggregate_mwi', type: bool },
  { name: 'device_state_busy_at', type: int(0) },
  { name: 'one_touch_recording', type: bool },
  { name: 'record_on_feature', type: str(40) },
  { name: 'record_off_feature', type: str(40) },
  { name: '100rel', type: en('no', 'required', 'yes', 'peer_supported') },
  { name: 'connected_line_method', type: en('invite', 'reinvite', 'update') },
  { name: 'direct_media_method', type: en('invite', 'reinvite', 'update') },
  { name: 'disable_direct_media_on_nat', type: bool },
  { name: 'moh_passthrough', type: bool },
  { name: 'outbound_proxy', type: str(255) },
  { name: 'preferred_codec_only', type: bool },
  { name: 'trust_connected_line', type: bool, since: 18 },
  { name: 'send_connected_line', type: bool, since: 18 },
  { name: 'user_eq_phone', type: bool },
  { name: 'refer_blind_progress', type: bool },
  { name: 'notify_early_inuse_ringing', type: bool },
  { name: 'max_audio_streams', type: int(1) },
  { name: 'suppress_q850_reason_headers', type: bool },
  { name: 'ignore_183_without_sdp', type: bool },
  { name: 'incoming_call_offer_pref', type: en('local', 'local_first', 'remote', 'remote_first'), since: 18 },
  { name: 'outgoing_call_offer_pref', type: en('local', 'local_merge', 'local_first', 'remote', 'remote_merge', 'remote_first'), since: 18 },
  { name: 'stir_shaken', type: bool, since: 18, removedIn: 20 },
  { name: 'stir_shaken_profile', type: str(80), since: 20 },
  { name: 'security_negotiation', type: en('no', 'mediasec'), since: 20 },
  { name: 'security_mechanisms', type: str(255), since: 20 },
  { name: 'send_aoc', type: bool, since: 20 },
  { name: 'overlap_context', type: str(80), since: 20 },
  { name: 'tenantid', type: str(80), since: 20 },
  { name: 'suppress_moh_on_sendonly', type: bool, since: 22 },
  { name: 'dtls_verify', type: en('yes', 'no', 'fingerprint', 'certificate') },
  { name: 'dtls_cert_file', type: str(255) },
  { name: 'dtls_private_key', type: str(255) },
  { name: 'dtls_ca_file', type: str(255) },
  { name: 'dtls_setup', type: en('active', 'passive', 'actpass') },
  { name: 'srtp_tag_32', type: bool },
];

const AOR: OptionSpec[] = [
  { name: 'max_contacts', type: int(0, 1000), common: true },
  { name: 'remove_existing', type: bool, common: true },
  { name: 'remove_unavailable', type: bool, since: 18 },
  { name: 'default_expiration', type: int(1), common: true },
  { name: 'minimum_expiration', type: int(1), common: true },
  { name: 'maximum_expiration', type: int(1), common: true },
  { name: 'qualify_frequency', type: int(0, 86400), common: true },
  { name: 'qualify_timeout', type: { t: 'string', max: 10, pattern: /^\d+(\.\d+)?$/ }, common: true },
  { name: 'qualify_2xx_only', type: bool, since: 22 },
  { name: 'contact', type: str(1024), common: true },
  { name: 'authenticate_qualify', type: bool, common: true },
  { name: 'support_path', type: bool, common: true },
  { name: 'outbound_proxy', type: str(255) },
  { name: 'mailboxes', type: str(255) },
  { name: 'voicemail_extension', type: str(80) },
];

const AUTH: OptionSpec[] = [
  { name: 'auth_type', type: en('userpass', 'md5', 'google_oauth', 'digest'), common: true },
  { name: 'username', type: str(80), common: true },
  { name: 'password', type: { t: 'secret' }, common: true },
  { name: 'md5_cred', type: { t: 'secret' } },
  { name: 'realm', type: str(80), common: true },
  { name: 'nonce_lifetime', type: int(1) },
  { name: 'refresh_token', type: { t: 'secret' } },
  { name: 'oauth_clientid', type: str(255) },
  { name: 'oauth_secret', type: { t: 'secret' } },
  { name: 'password_digest', type: { t: 'secret' }, since: 22 },
  { name: 'supported_algorithms_uac', type: str(120), since: 22 },
  { name: 'supported_algorithms_uas', type: str(120), since: 22 },
];

const IDENTIFY: OptionSpec[] = [
  { name: 'endpoint', type: str(40), common: true },
  { name: 'match', type: { t: 'ipList' }, common: true },
  { name: 'match_header', type: str(255), common: true },
  { name: 'match_request_uri', type: str(255), since: 20, common: true },
  { name: 'srv_lookups', type: bool },
];

const TRANSPORT: OptionSpec[] = [
  { name: 'protocol', type: en('udp', 'tcp', 'tls', 'ws', 'wss', 'flow'), common: true },
  { name: 'bind', type: str(80), common: true },
  { name: 'external_signaling_address', type: str(120), common: true },
  { name: 'external_signaling_port', type: int(0, 65535) },
  { name: 'external_media_address', type: str(120), common: true },
  { name: 'local_net', type: { t: 'ipList' }, common: true },
  { name: 'cert_file', type: str(255), common: true },
  { name: 'priv_key_file', type: str(255), common: true },
  { name: 'ca_list_file', type: str(255), common: true },
  { name: 'ca_list_path', type: str(255) },
  { name: 'method', type: en('default', 'unspecified', 'tlsv1', 'tlsv1_1', 'tlsv1_2', 'tlsv1_3', 'sslv2', 'sslv3', 'sslv23'), common: true },
  { name: 'verify_server', type: bool, common: true },
  { name: 'verify_client', type: bool, common: true },
  { name: 'require_client_cert', type: bool, common: true },
  { name: 'cipher', type: str(1024) },
  { name: 'password', type: { t: 'secret' } },
  { name: 'tos', type: str(10) },
  { name: 'cos', type: int(0, 7) },
  { name: 'allow_reload', type: bool },
  { name: 'symmetric_transport', type: bool },
  { name: 'allow_wildcard_certs', type: bool, since: 18 },
  { name: 'tcp_keepalive_enable', type: bool, since: 20 },
  { name: 'tcp_keepalive_idle_time', type: int(1), since: 20 },
  { name: 'tcp_keepalive_interval_time', type: int(1), since: 20 },
  { name: 'tcp_keepalive_probe_count', type: int(1), since: 20 },
];

const REGISTRATION: OptionSpec[] = [
  { name: 'server_uri', type: str(255), common: true },
  { name: 'client_uri', type: str(255), common: true },
  { name: 'contact_user', type: str(80), common: true },
  { name: 'transport', type: str(40), common: true },
  { name: 'outbound_auth', type: str(40), common: true },
  { name: 'expiration', type: int(1), common: true },
  { name: 'retry_interval', type: int(1), common: true },
  { name: 'forbidden_retry_interval', type: int(0) },
  { name: 'fatal_retry_interval', type: int(0) },
  { name: 'max_retries', type: int(0), common: true },
  { name: 'auth_rejection_permanent', type: bool },
  { name: 'line', type: bool },
  { name: 'endpoint', type: str(40) },
  { name: 'outbound_proxy', type: str(255) },
  { name: 'support_path', type: bool },
  { name: 'support_outbound', type: bool, since: 18 },
  { name: 'contact_header_params', type: str(255), since: 20 },
  { name: 'max_random_initial_delay', type: int(0), since: 18 },
];

const GLOBAL: OptionSpec[] = [
  { name: 'user_agent', type: str(120), common: true },
  { name: 'default_outbound_endpoint', type: str(40) },
  { name: 'debug', type: str(40) },
  { name: 'keep_alive_interval', type: int(0) },
  { name: 'max_forwards', type: int(1, 255) },
  { name: 'endpoint_identifier_order', type: str(255), common: true },
  { name: 'default_from_user', type: str(80) },
  { name: 'default_realm', type: str(80) },
  { name: 'mwi_tps_queue_high', type: int(0) },
  { name: 'unidentified_request_count', type: int(0) },
  { name: 'unidentified_request_period', type: int(0) },
  { name: 'contact_expiration_check_interval', type: int(0) },
  { name: 'disable_multi_domain', type: bool },
  { name: 'ignore_uri_user_options', type: bool },
  { name: 'send_contact_status_on_update_registration', type: bool },
  { name: 'taskprocessor_overload_trigger', type: en('none', 'global', 'pjsip_only') },
  { name: 'norefersub', type: bool, since: 18 },
  { name: 'allow_sending_180_after_183', type: bool, since: 18 },
  { name: 'all_codecs_on_empty_reinvite', type: bool, since: 20 },
];

const DOMAIN_ALIAS: OptionSpec[] = [{ name: 'domain', type: str(255), common: true }];

export const PJSIP_CATALOG: Record<PjsipObjectType, readonly OptionSpec[]> = {
  endpoint: ENDPOINT,
  aor: AOR,
  auth: AUTH,
  identify: IDENTIFY,
  transport: TRANSPORT,
  registration: REGISTRATION,
  global: GLOBAL,
  domain_alias: DOMAIN_ALIAS,
};

/** Sorcery realtime table for each object type. */
export const SORCERY_TABLES: Record<PjsipObjectType, string | null> = {
  endpoint: 'ps_endpoints',
  aor: 'ps_aors',
  auth: 'ps_auths',
  identify: 'ps_endpoint_id_ips',
  registration: 'ps_registrations',
  global: 'ps_globals',
  domain_alias: 'ps_domain_aliases',
  transport: null, // compiled to pjsip_echelons_transports.conf (see docs/05 §4)
};

export function optionsFor(type: PjsipObjectType, asteriskMajor: number): OptionSpec[] {
  return PJSIP_CATALOG[type].filter(
    (o) => (o.since === undefined || asteriskMajor >= o.since) && (o.removedIn === undefined || asteriskMajor < o.removedIn),
  );
}

export function findOption(type: PjsipObjectType, name: string): OptionSpec | undefined {
  return PJSIP_CATALOG[type].find((o) => o.name === name);
}
