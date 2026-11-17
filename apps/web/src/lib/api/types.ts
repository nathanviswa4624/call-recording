/** Response models mirroring the backend (apps/backend/src/modules/**). */

export type Uuid = string;
export type Connectivity = 'UNKNOWN' | 'REACHABLE' | 'UNREACHABLE' | 'LAGGED' | 'DISABLED';
export type SipProtocol = 'udp' | 'tcp' | 'tls' | 'ws' | 'wss';
export type ParamValue = string | number | boolean | null;
export type Params = Record<string, ParamValue>;

export interface Me {
  id: Uuid; name: string; organizationId: Uuid; organization: { name: string; slug: string } | null;
  permissions: string[]; sites: Uuid[]; username?: string; email?: string; extensions?: string[]; department?: string | null; mfaEnabled?: boolean;
}

export interface Site { id: Uuid; name: string; code: string; timezone: string }

export interface AsteriskServer {
  id: Uuid; name: string; siteId: Uuid; connectorUrl: string; versionString: string | null; versionMajor: number | null;
  status: Connectivity; lastSeenAt: string | null; restartRequired: boolean; strictCatalog: boolean; recordingBasePath: string; realtimeSchema: string;
}

export interface Pbx {
  id: Uuid; siteId: Uuid; serverId: Uuid; name: string; code: string; description: string | null; vendor: string; host: string; port: number;
  protocol: SipProtocol; sipMode: SipMode; authMode: AuthMode; inboundContext: string; outboundContext: string | null; recordingPolicyId: Uuid | null;
  enabled: boolean; status: Connectivity; lastCheckAt: string | null; lastCheckResult: TrunkTestResults | null;
  _count?: { trunks: number; routes: number }; site?: { id: Uuid; name: string }; server?: { id: Uuid; name: string };
}

export type SipMode = 'PEER' | 'REGISTER_OUTBOUND' | 'ACCEPT_REGISTRATION';
export type AuthMode = 'NONE' | 'IP' | 'USERPASS';

export interface Trunk {
  id: Uuid; pbxId: Uuid; templateId: Uuid | null; name: string; host: string; port: number; protocol: 'udp' | 'tcp' | 'tls'; transportName: string;
  authMode: AuthMode; sipMode: SipMode; username: string | null; hasPassword: boolean; realm: string | null; remoteDomain: string | null;
  inboundContext: string; outboundContext: string | null; matchNetworks: string[]; qualifyFrequency: number; overrides: Record<string, Params | undefined>;
  recordingPolicyId: Uuid | null; enabled: boolean; status: Connectivity; lastRttMs: number | null; pbx?: { id: Uuid; name: string; code: string; vendor: string };
}

export interface TrunkInput {
  name: string; templateId?: Uuid | null; host: string; port: number; protocol: 'udp' | 'tcp' | 'tls'; transportName: string; authMode: AuthMode; sipMode: SipMode;
  username?: string | null; password?: string; realm?: string | null; remoteDomain?: string | null; inboundContext: string; outboundContext?: string | null;
  matchNetworks: string[]; qualifyFrequency: number; overrides: { endpoint?: Params; aor?: Params; identify?: Params; registration?: Params };
  recordingPolicyId?: Uuid | null; enabled: boolean;
}

export type TrunkTestResults = Record<string, { status: 'OK' | 'FAILED' | 'SKIPPED'; detail?: string }>;

export interface TrunkTemplate { id: Uuid; code: string; vendor: string; name: string; description: string | null; defaultProtocol: SipProtocol; defaultPort: number; defaults: { endpoint?: Params; aor?: Params; identify?: Params; registration?: Params }; builtin: boolean }

export type PjsipKind = 'endpoints' | 'aors' | 'auths' | 'identifies' | 'transports' | 'registrations';

export interface PjsipObject {
  id: Uuid; serverId: Uuid; name: string; params: Params; origin: 'CREATED' | 'IMPORTED' | 'TRUNK_GENERATED'; managedByTrunkId?: Uuid | null;
  enabled?: boolean; endpointName?: string; pending: boolean; draftHash: string | null; publishedHash: string | null;
  // auths
  authType?: string; username?: string | null; realm?: string | null; hasSecret?: boolean;
  // transports
  protocol?: SipProtocol; bindAddress?: string; bindPort?: number;
}

export interface CatalogOption { name: string; type: string; common: boolean; since?: number; values?: string[]; min?: number; max?: number }

export interface RecordingPolicy { id: Uuid; name: string; mode: 'NEVER' | 'ALWAYS' | 'INBOUND_ONLY' | 'OUTBOUND_ONLY' | 'ON_DEMAND'; layout: 'MIXED' | 'MIXED_AND_SPLIT'; format: 'wav' | 'wav49' | 'gsm'; isDefault: boolean }
export interface CallType { id: Uuid; code: string; name: string; color: string | null; builtin: boolean }

export type RouteDirection = 'INBOUND' | 'OUTBOUND' | 'INTERNAL' | 'TRANSIT';
export interface RoutePattern { id: Uuid; routeId: Uuid; pattern: string; prefix: string | null; stripDigits: number; prepend: string | null; description: string | null; recordingPolicyId: Uuid | null; enabled: boolean }
export interface Route {
  id: Uuid; routeNumber: number; name: string; description: string | null; pbxId: Uuid; direction: RouteDirection; priority: number;
  egressKind: 'TRUNK' | 'CONTEXT' | 'HANGUP'; egressTrunkId: Uuid | null; egressContext: string | null; callTypeId: Uuid | null; recordingPolicyId: Uuid | null;
  callerIdNumber: string | null; callerIdName: string | null; dialTimeout: number; dialOptions: string | null; enabled: boolean;
  patterns: RoutePattern[]; pbx?: { id: Uuid; name: string; code: string }; egressTrunk?: { id: Uuid; name: string } | null;
  callType?: CallType | null; recordingPolicy?: RecordingPolicy | null; warnings?: string[];
}
export interface RouteInput {
  routeNumber?: number; name: string; description?: string | null; pbxId: Uuid; direction: RouteDirection; priority: number;
  egressKind: 'TRUNK' | 'CONTEXT' | 'HANGUP'; egressTrunkId?: Uuid | null; egressContext?: string | null; callTypeId?: Uuid | null; recordingPolicyId?: Uuid | null;
  callerIdNumber?: string | null; callerIdName?: string | null; dialTimeout: number; dialOptions?: string | null; enabled: boolean;
  patterns: Array<{ pattern: string; prefix?: string | null; stripDigits: number; prepend?: string | null; description?: string | null; recordingPolicyId?: Uuid | null; enabled: boolean }>;
}
export interface PatternListItem extends RoutePattern { route: { id: Uuid; name: string; routeNumber: number; direction: RouteDirection; priority: number; pbx: { id: Uuid; name: string; code: string } } }

export type RouteTestResult =
  | { matched: false; number: string; considered: number }
  | {
      matched: true; number: string; route: { id: Uuid; name: string; routeNumber: number; direction: RouteDirection; priority: number };
      pattern: { id: Uuid; pattern: string }; dialled: string; egress: { kind: string; trunk?: string; context?: string | null };
      prefix: string; stripDigits: number; prepend: string; callType: { code: string; name: string } | null;
      recordingPolicy: { name: string; mode: string; layout: string; format: string };
    };

export interface ClassificationRule { id: Uuid; name: string; priority: number; enabled: boolean; match: 'all' | 'any'; conditions: Array<{ field: string; op: string; value?: unknown; header?: string }>; actions: { callTypeCode?: string; routeId?: string; direction?: string; tags?: string[] }; stop: boolean }

export interface DialplanContext {
  id: Uuid; serverId: Uuid; name: string; description: string | null; includes: string[]; readOnly: boolean; origin: string;
  extensions: Array<{ id: Uuid; exten: string; sortOrder: number; priorities: Array<{ id: Uuid; position: number; label: string | null; app: string; args: string }> }>;
}

export type AnswerStatus = 'ANSWERED' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'CONGESTION' | 'ABANDONED';
export type CallDirection = 'INBOUND' | 'OUTBOUND' | 'INTERNAL' | 'TRANSIT' | 'UNKNOWN';

export interface CallRow {
  id: Uuid; start_time: string; answer_time: string | null; end_time: string | null; caller_number: string | null; caller_name: string | null;
  destination_number: string | null; dialed_number: string | null; direction: CallDirection; answer_status: AnswerStatus; billsec: number; duration: number;
  extension: string | null; has_recording: boolean; uniqueid: string; linkedid: string; call_type: string | null; call_type_name: string | null;
  call_type_color: string | null; route_name: string | null; route_pattern: string | null; pbx_name: string | null; trunk_name: string | null;
}

export interface RecordingRow {
  call_id: Uuid; recording_id: Uuid; start_time: string; caller_number: string | null; caller_name: string | null; destination_number: string | null;
  direction: CallDirection; answer_status: AnswerStatus; billsec: number; duration: number; call_type: string | null; call_type_name: string | null;
  route_name: string | null; route_pattern: string | null; pbx_name: string | null; trunk_name?: string | null; extension: string | null;
  department: string | null; format: string; layout: string; size_bytes: number; duration_sec: number | null; state: RecordingState;
}
export type RecordingState = 'RECORDING' | 'CLOSED' | 'PROCESSING' | 'AVAILABLE' | 'ARCHIVED' | 'MISSING_FILE' | 'DELETED';

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface CallSummary { total: number; answered: number; missed: number; failed: number; busy: number; inbound: number; outbound: number; internal: number; total_billsec: number; avg_billsec: number; recordings: number }

export interface CallDetail {
  id: Uuid; uniqueid: string; linkedid: string; sipCallId: string | null; direction: CallDirection; callerNumber: string | null; callerName: string | null;
  destinationNumber: string | null; destinationName: string | null; dialedNumber: string | null; extension: string | null; department: string | null; queue: string | null;
  context: string | null; startTime: string; answerTime: string | null; endTime: string | null; duration: number; billsec: number; answerStatus: AnswerStatus;
  hangupCause: number | null; sipResponse: number | null; sourceIp: string | null; destinationIp: string | null; userAgent: string | null; transport: string | null;
  tags: string[]; classifiedBy: string[]; hasRecording: boolean;
  sourcePbx: { id: Uuid; name: string; code: string; vendor: string; host: string } | null; destinationPbx: { id: Uuid; name: string; code: string } | null;
  trunk: { id: Uuid; name: string; host: string; protocol: string } | null;
  route: { id: Uuid; name: string; routeNumber: number; direction: string; egressTrunk: { name: string } | null } | null;
  routePattern: { id: Uuid; pattern: string; prefix: string | null } | null; callType: CallType | null;
  recordings: Array<{ id: Uuid; format: string; layout: string; sizeBytes: number; durationSec: number | null; state: RecordingState; baseName: string }>;
  cdrs: Array<{ id: Uuid; uniqueid: string; calldate: string; answerdate: string | null; enddate: string | null; duration: number; billsec: number; disposition: string; channel: string | null; dstchannel: string | null; src: string | null; dst: string | null; dcontext: string | null; lastapp: string | null; lastdata: string | null; accountcode: string | null; userfield: string | null; extra: Record<string, unknown> }>;
  events: Array<{ id: Uuid; at: string; kind: string; label: string; data: Record<string, unknown> }>;
  flow: { nodes: Array<{ id: string; kind: string; label: string; edge?: string }>; recording: string; status: string };
}

export interface RecordingDetail {
  id: Uuid; callId: Uuid | null; baseName: string; format: string; layout: string; sizeBytes: number; durationSec: number | null; state: RecordingState;
  startedAt: string; endedAt: string | null; retentionExpiresAt: string | null; legalHold: boolean;
  channels: { mixed: boolean; caller: boolean; callee: boolean; mp3: boolean }; storage: { id: Uuid; name: string; kind: string };
  tags: string[]; notes: Array<{ id: Uuid; body: string; authorId: Uuid; createdAt: string }>;
}

export interface LiveCall {
  linkedid: string; caller: string; destination: string; pbxCode: string | null; pbxId: string | null; pbxName?: string | null; routeId: string | null;
  routeName?: string | null; direction: string | null; startedAt: number; channels: number; recording: 'ACTIVE' | 'NONE' | 'COMPLETE'; answered: boolean;
  serverId: string; serverName?: string;
}

export interface DashboardData {
  date: string;
  today: Partial<Record<'total' | 'answered' | 'missed' | 'failed' | 'busy' | 'inbound' | 'outbound' | 'internal', number>>;
  recordings: { total: number; durationSec: number; storageBytes: number };
  infrastructure: Partial<Record<'active_trunks' | 'failed_trunks' | 'servers' | 'servers_up', number>>;
  charts: Record<'perHour' | 'perDay' | 'byPbx' | 'byRoute' | 'byCallType' | 'byExtension' | 'durationBuckets', Array<Record<string, string | number | null>>>;
}

export type HealthLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export interface SystemHealth {
  database: { status: HealthLevel; detail?: string };
  asterisk: Array<{ id: Uuid; name: string; connector: HealthLevel; ami: HealthLevel; ari: HealthLevel; version: string | null; uptimeSec: number | null; restartRequired: boolean }>;
}

export interface AsteriskStatus {
  server: string; connected: boolean; error?: string; ari?: boolean; version?: string | null; uptimeSec?: number | null; restartRequired?: boolean;
  system?: { hostname: string; cpuCount: number; load1: number; cpuPercent: number; memTotalBytes: number; memFreeBytes: number; uptimeSec: number; recordingDisk: { totalBytes: number; freeBytes: number } | null } | null;
  activeChannels?: number; activeCalls?: number; recordingChannels?: number;
  endpoints?: { total: number; available: number; unavailable: string[] };
  registrations?: Array<{ name: string; status: string; serverUri: string }>;
}

export interface CliCommand { id: string; tier: 'read' | 'active'; example: string; description: string }

export interface ConfigVersion {
  id: Uuid; version: number; status: 'DRAFT' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'ROLLED_BACK'; summary: string | null; changes: Record<string, unknown> | null;
  error: string | null; createdAt: string; appliedAt: string | null; changedBy: { id?: Uuid; displayName: string } | null;
}
export interface ConfigVersionDetail extends ConfigVersion { snapshot: { tables: Record<string, Array<Record<string, string | null>>>; dialplan: string; transports: string } }
export interface ConfigDiffResult {
  from: number; to: number;
  tables: Record<string, { added: string[]; removed: string[]; changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }> }>;
  dialplan: { from: string; to: string }; transports: { from: string; to: string };
}
export interface ApplyIssue { severity: 'error' | 'warning'; object: string; field?: string; message: string }
export interface ApplyResult { versionId: string | null; version: number | null; status: 'APPLIED' | 'FAILED' | 'VALIDATION_FAILED' | 'NO_CHANGES'; issues: ApplyIssue[]; steps: Array<{ step: string; status: string; message?: string; at: string }>; restartRequired: boolean }
export interface PendingChanges { serverId: string; endpoints: number; aors: number; auths: number; identifies: number; registrations: number; transports: number; lastApplied: { version: number; appliedAt: string | null } | null }

export interface AuditEntry { id: Uuid; userId: Uuid | null; ip: string | null; userAgent: string | null; action: string; objectType: string | null; objectId: string | null; objectLabel: string | null; oldValue: unknown; newValue: unknown; result: 'SUCCESS' | 'FAILURE'; error: string | null; requestId: string | null; createdAt: string; user: { displayName: string; username: string } | null }

export interface User { id: Uuid; email: string; username: string; displayName: string; status: 'ACTIVE' | 'DISABLED' | 'LOCKED'; lastLoginAt: string | null; mfaEnabled: boolean; extensions: string[]; department: string | null; createdAt: string; roles: Array<{ role: { id: Uuid; code: string; name: string } }>; siteAccess: Array<{ siteId: Uuid }> }
export interface Role { id: Uuid; code: string; name: string; description: string | null; builtin: boolean; organizationId: Uuid | null; permissions: string[] }

export interface ReportRow { label: string; calls: number; answered: number; missed: number; failed: number; inbound: number; outbound: number; total_billsec: number; avg_billsec: number; recordings: number }
