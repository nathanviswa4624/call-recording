-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SipProtocol" AS ENUM ('udp', 'tcp', 'tls', 'ws', 'wss');

-- CreateEnum
CREATE TYPE "TrunkAuthMode" AS ENUM ('NONE', 'IP', 'USERPASS');

-- CreateEnum
CREATE TYPE "SipMode" AS ENUM ('PEER', 'REGISTER_OUTBOUND', 'ACCEPT_REGISTRATION');

-- CreateEnum
CREATE TYPE "ObjectOrigin" AS ENUM ('CREATED', 'IMPORTED', 'TRUNK_GENERATED');

-- CreateEnum
CREATE TYPE "ConnectivityStatus" AS ENUM ('UNKNOWN', 'REACHABLE', 'UNREACHABLE', 'LAGGED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RouteDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EgressKind" AS ENUM ('TRUNK', 'CONTEXT', 'HANGUP');

-- CreateEnum
CREATE TYPE "RecordingMode" AS ENUM ('NEVER', 'ALWAYS', 'INBOUND_ONLY', 'OUTBOUND_ONLY', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "RecordingLayout" AS ENUM ('MIXED', 'MIXED_AND_SPLIT');

-- CreateEnum
CREATE TYPE "RecordingFormat" AS ENUM ('wav', 'wav49', 'gsm');

-- CreateEnum
CREATE TYPE "AnswerStatus" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CONGESTION', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RecordingState" AS ENUM ('RECORDING', 'CLOSED', 'PROCESSING', 'AVAILABLE', 'ARCHIVED', 'MISSING_FILE', 'DELETED');

-- CreateEnum
CREATE TYPE "StorageKind" AS ENUM ('LOCAL', 'NFS', 'NAS', 'S3');

-- CreateEnum
CREATE TYPE "ConfigVersionStatus" AS ENUM ('DRAFT', 'APPLYING', 'APPLIED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "last_login_ip" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "extensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "department" TEXT,
    "permission_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_site_access" (
    "user_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,

    CONSTRAINT "user_site_access_pkey" PRIMARY KEY ("user_id","site_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asterisk_servers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "connector_url" TEXT NOT NULL,
    "connector_token_enc" TEXT NOT NULL,
    "version_string" TEXT,
    "version_major" INTEGER,
    "strict_catalog" BOOLEAN NOT NULL DEFAULT true,
    "recording_base_path" TEXT NOT NULL DEFAULT '/var/spool/asterisk/recording',
    "realtime_schema" TEXT NOT NULL DEFAULT 'asterisk',
    "restart_required" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ(3),
    "status" "ConnectivityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "cdr_watermark" BIGINT NOT NULL DEFAULT 0,
    "cel_watermark" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asterisk_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pbxs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 5060,
    "protocol" "SipProtocol" NOT NULL DEFAULT 'udp',
    "sip_mode" "SipMode" NOT NULL DEFAULT 'PEER',
    "auth_mode" "TrunkAuthMode" NOT NULL DEFAULT 'IP',
    "inbound_context" TEXT NOT NULL,
    "outbound_context" TEXT,
    "recording_policy_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConnectivityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_check_at" TIMESTAMPTZ(3),
    "last_check_result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pbxs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trunk_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_protocol" "SipProtocol" NOT NULL DEFAULT 'udp',
    "default_port" INTEGER NOT NULL DEFAULT 5060,
    "defaults" JSONB NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trunk_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_trunks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pbx_id" UUID NOT NULL,
    "template_id" UUID,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 5060,
    "protocol" "SipProtocol" NOT NULL DEFAULT 'udp',
    "transport_name" TEXT NOT NULL,
    "auth_mode" "TrunkAuthMode" NOT NULL DEFAULT 'IP',
    "sip_mode" "SipMode" NOT NULL DEFAULT 'PEER',
    "username" TEXT,
    "password_enc" TEXT,
    "realm" TEXT,
    "remote_domain" TEXT,
    "inbound_context" TEXT NOT NULL,
    "outbound_context" TEXT,
    "match_networks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualify_frequency" INTEGER NOT NULL DEFAULT 60,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "recording_policy_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConnectivityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_rtt_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_trunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_transports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "SipProtocol" NOT NULL,
    "bind_address" TEXT NOT NULL DEFAULT '0.0.0.0',
    "bind_port" INTEGER NOT NULL DEFAULT 5060,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_transports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by_trunk_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_aors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by_trunk_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_aors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_contacts" (
    "id" UUID NOT NULL,
    "aor_id" UUID NOT NULL,
    "uri" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sip_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_auths" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by_trunk_id" UUID,
    "auth_type" TEXT NOT NULL DEFAULT 'userpass',
    "username" TEXT,
    "secret_enc" TEXT,
    "realm" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_auths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_identifies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by_trunk_id" UUID,
    "endpoint_name" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_identifies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_registrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "managed_by_trunk_id" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_domain_aliases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sip_domain_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_globals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "draft_hash" TEXT,
    "published_hash" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sip_globals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sorcery_mappings" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "wizard" TEXT NOT NULL,
    "wizard_data" TEXT NOT NULL,
    "cache_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cache_options" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sorcery_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "RecordingMode" NOT NULL DEFAULT 'ALWAYS',
    "layout" "RecordingLayout" NOT NULL DEFAULT 'MIXED',
    "format" "RecordingFormat" NOT NULL DEFAULT 'wav',
    "post_formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keep_original" BOOLEAN NOT NULL DEFAULT true,
    "storage_location_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recording_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "route_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pbx_id" UUID NOT NULL,
    "direction" "RouteDirection" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "egress_kind" "EgressKind" NOT NULL DEFAULT 'TRUNK',
    "egress_trunk_id" UUID,
    "egress_context" TEXT,
    "call_type_id" UUID,
    "recording_policy_id" UUID,
    "caller_id_number" TEXT,
    "caller_id_name" TEXT,
    "dial_timeout" INTEGER NOT NULL DEFAULT 60,
    "dial_options" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_patterns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "prefix" TEXT,
    "strip_digits" INTEGER NOT NULL DEFAULT 0,
    "prepend" TEXT,
    "description" TEXT,
    "recording_policy_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "route_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "match" TEXT NOT NULL DEFAULT 'all',
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "stop" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialplan_contexts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "includes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "read_only" BOOLEAN NOT NULL DEFAULT false,
    "origin" "ObjectOrigin" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dialplan_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialplan_extensions" (
    "id" UUID NOT NULL,
    "context_id" UUID NOT NULL,
    "exten" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dialplan_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dialplan_priorities" (
    "id" UUID NOT NULL,
    "extension_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "app" TEXT NOT NULL,
    "args" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "dialplan_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extensions_dir" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pbx_id" UUID NOT NULL,
    "extension" TEXT NOT NULL,
    "display_name" TEXT,
    "agent_user_id" UUID,
    "department" TEXT,
    "queue" TEXT,

    CONSTRAINT "extensions_dir_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cdr_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "call_id" UUID,
    "source_seq" BIGINT NOT NULL,
    "uniqueid" TEXT NOT NULL,
    "linkedid" TEXT NOT NULL,
    "calldate" TIMESTAMPTZ(3) NOT NULL,
    "answerdate" TIMESTAMPTZ(3),
    "enddate" TIMESTAMPTZ(3),
    "duration" INTEGER NOT NULL,
    "billsec" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL,
    "channel" TEXT,
    "dstchannel" TEXT,
    "src" TEXT,
    "dst" TEXT,
    "clid" TEXT,
    "dcontext" TEXT,
    "lastapp" TEXT,
    "lastdata" TEXT,
    "accountcode" TEXT,
    "amaflags" INTEGER,
    "userfield" TEXT,
    "peeraccount" TEXT,
    "sequence" INTEGER,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cdr_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cel_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "call_id" UUID,
    "source_seq" BIGINT NOT NULL,
    "eventtype" TEXT NOT NULL,
    "eventtime" TIMESTAMPTZ(6) NOT NULL,
    "uniqueid" TEXT NOT NULL,
    "linkedid" TEXT NOT NULL,
    "cid_num" TEXT,
    "exten" TEXT,
    "context" TEXT,
    "channame" TEXT,
    "appname" TEXT,
    "appdata" TEXT,
    "peer" TEXT,
    "extra" TEXT,

    CONSTRAINT "cel_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "server_id" UUID NOT NULL,
    "uniqueid" TEXT NOT NULL,
    "linkedid" TEXT NOT NULL,
    "sip_call_id" TEXT,
    "source_pbx_id" UUID,
    "destination_pbx_id" UUID,
    "trunk_id" UUID,
    "route_id" UUID,
    "route_pattern_id" UUID,
    "call_type_id" UUID,
    "direction" "CallDirection" NOT NULL DEFAULT 'UNKNOWN',
    "caller_number" TEXT,
    "caller_name" TEXT,
    "destination_number" TEXT,
    "destination_name" TEXT,
    "dialed_number" TEXT,
    "extension" TEXT,
    "agent_user_id" UUID,
    "department" TEXT,
    "queue" TEXT,
    "campaign" TEXT,
    "context" TEXT,
    "start_time" TIMESTAMPTZ(3) NOT NULL,
    "answer_time" TIMESTAMPTZ(3),
    "end_time" TIMESTAMPTZ(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "billsec" INTEGER NOT NULL DEFAULT 0,
    "answer_status" "AnswerStatus" NOT NULL DEFAULT 'FAILED',
    "hangup_cause" INTEGER,
    "sip_response" INTEGER,
    "source_ip" TEXT,
    "destination_ip" TEXT,
    "user_agent" TEXT,
    "transport" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classified_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_recording" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StorageKind" NOT NULL,
    "base_path" TEXT NOT NULL,
    "endpoint" TEXT,
    "region" TEXT,
    "access_key_enc" TEXT,
    "secret_key_enc" TEXT,
    "force_path_style" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "call_id" UUID,
    "storage_location_id" UUID NOT NULL,
    "base_name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "layout" "RecordingLayout" NOT NULL DEFAULT 'MIXED',
    "files" JSONB NOT NULL DEFAULT '{}',
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "duration_sec" INTEGER,
    "sha256" TEXT,
    "state" "RecordingState" NOT NULL DEFAULT 'RECORDING',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "waveform" JSONB,
    "retention_expires_at" TIMESTAMPTZ(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_tags" (
    "recording_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_tags_pkey" PRIMARY KEY ("recording_id","tag")
);

-- CreateTable
CREATE TABLE "recording_notes" (
    "id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_access_grants" (
    "id" UUID NOT NULL,
    "recording_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keep_days" INTEGER,
    "pbx_id" UUID,
    "call_type_id" UUID,
    "route_id" UUID,
    "department" TEXT,
    "layout" "RecordingLayout",
    "storage_location_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "started_by" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "examined" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "missing" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "bytes_freed" BIGINT NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "action" TEXT NOT NULL,
    "object_type" TEXT,
    "object_id" TEXT,
    "object_label" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "result" "AuditResult" NOT NULL,
    "error" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ConfigVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changed_by_id" UUID,
    "summary" TEXT,
    "snapshot" JSONB NOT NULL,
    "secrets_enc" TEXT,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "dialplan_hash" TEXT,
    "error" TEXT,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "server_id" UUID,
    "created_by_id" UUID,
    "path" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "includes_secrets" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sites_organization_id_code_key" ON "sites"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_email_key" ON "users"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_username_key" ON "users"("organization_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_code_key" ON "roles"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "asterisk_servers_organization_id_name_key" ON "asterisk_servers"("organization_id", "name");

-- CreateIndex
CREATE INDEX "pbxs_organization_id_site_id_idx" ON "pbxs"("organization_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "pbxs_server_id_code_key" ON "pbxs"("server_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "trunk_templates_organization_id_code_key" ON "trunk_templates"("organization_id", "code");

-- CreateIndex
CREATE INDEX "sip_trunks_organization_id_idx" ON "sip_trunks"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sip_trunks_pbx_id_name_key" ON "sip_trunks"("pbx_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_transports_server_id_name_key" ON "sip_transports"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_endpoints_server_id_name_key" ON "sip_endpoints"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_aors_server_id_name_key" ON "sip_aors"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_auths_server_id_name_key" ON "sip_auths"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_identifies_server_id_name_key" ON "sip_identifies"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_registrations_server_id_name_key" ON "sip_registrations"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_domain_aliases_server_id_name_key" ON "sip_domain_aliases"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sip_globals_server_id_key" ON "sip_globals"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "sorcery_mappings_server_id_module_object_type_wizard_key" ON "sorcery_mappings"("server_id", "module", "object_type", "wizard");

-- CreateIndex
CREATE UNIQUE INDEX "recording_policies_organization_id_name_key" ON "recording_policies"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "call_types_organization_id_code_key" ON "call_types"("organization_id", "code");

-- CreateIndex
CREATE INDEX "routes_pbx_id_priority_idx" ON "routes"("pbx_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "routes_organization_id_route_number_key" ON "routes"("organization_id", "route_number");

-- CreateIndex
CREATE INDEX "route_patterns_organization_id_pattern_idx" ON "route_patterns"("organization_id", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "route_patterns_route_id_prefix_pattern_key" ON "route_patterns"("route_id", "prefix", "pattern");

-- CreateIndex
CREATE INDEX "classification_rules_organization_id_priority_idx" ON "classification_rules"("organization_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "dialplan_contexts_server_id_name_key" ON "dialplan_contexts"("server_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dialplan_extensions_context_id_exten_key" ON "dialplan_extensions"("context_id", "exten");

-- CreateIndex
CREATE UNIQUE INDEX "dialplan_priorities_extension_id_position_key" ON "dialplan_priorities"("extension_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "extensions_dir_pbx_id_extension_key" ON "extensions_dir"("pbx_id", "extension");

-- CreateIndex
CREATE INDEX "cdr_records_organization_id_calldate_idx" ON "cdr_records"("organization_id", "calldate" DESC);

-- CreateIndex
CREATE INDEX "cdr_records_uniqueid_idx" ON "cdr_records"("uniqueid");

-- CreateIndex
CREATE INDEX "cdr_records_linkedid_idx" ON "cdr_records"("linkedid");

-- CreateIndex
CREATE UNIQUE INDEX "cdr_records_server_id_source_seq_key" ON "cdr_records"("server_id", "source_seq");

-- CreateIndex
CREATE INDEX "cel_records_linkedid_idx" ON "cel_records"("linkedid");

-- CreateIndex
CREATE UNIQUE INDEX "cel_records_server_id_source_seq_key" ON "cel_records"("server_id", "source_seq");

-- CreateIndex
CREATE INDEX "calls_organization_id_start_time_id_idx" ON "calls"("organization_id", "start_time" DESC, "id");

-- CreateIndex
CREATE INDEX "calls_organization_id_caller_number_start_time_idx" ON "calls"("organization_id", "caller_number", "start_time" DESC);

-- CreateIndex
CREATE INDEX "calls_organization_id_destination_number_start_time_idx" ON "calls"("organization_id", "destination_number", "start_time" DESC);

-- CreateIndex
CREATE INDEX "calls_organization_id_source_pbx_id_start_time_idx" ON "calls"("organization_id", "source_pbx_id", "start_time" DESC);

-- CreateIndex
CREATE INDEX "calls_trunk_id_start_time_idx" ON "calls"("trunk_id", "start_time");

-- CreateIndex
CREATE INDEX "calls_route_id_start_time_idx" ON "calls"("route_id", "start_time");

-- CreateIndex
CREATE INDEX "calls_route_pattern_id_start_time_idx" ON "calls"("route_pattern_id", "start_time");

-- CreateIndex
CREATE INDEX "calls_organization_id_call_type_id_start_time_idx" ON "calls"("organization_id", "call_type_id", "start_time" DESC);

-- CreateIndex
CREATE INDEX "calls_organization_id_direction_start_time_idx" ON "calls"("organization_id", "direction", "start_time" DESC);

-- CreateIndex
CREATE INDEX "calls_uniqueid_idx" ON "calls"("uniqueid");

-- CreateIndex
CREATE INDEX "calls_agent_user_id_start_time_idx" ON "calls"("agent_user_id", "start_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "calls_server_id_linkedid_key" ON "calls"("server_id", "linkedid");

-- CreateIndex
CREATE INDEX "call_events_call_id_at_idx" ON "call_events"("call_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_organization_id_name_key" ON "storage_locations"("organization_id", "name");

-- CreateIndex
CREATE INDEX "recordings_organization_id_started_at_idx" ON "recordings"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "recordings_call_id_idx" ON "recordings"("call_id");

-- CreateIndex
CREATE INDEX "recordings_storage_location_id_retention_expires_at_idx" ON "recordings"("storage_location_id", "retention_expires_at");

-- CreateIndex
CREATE INDEX "recordings_state_idx" ON "recordings"("state");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_storage_location_id_base_name_key" ON "recordings"("storage_location_id", "base_name");

-- CreateIndex
CREATE INDEX "recording_tags_tag_idx" ON "recording_tags"("tag");

-- CreateIndex
CREATE INDEX "recording_notes_recording_id_idx" ON "recording_notes"("recording_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_access_grants_recording_id_user_id_key" ON "recording_access_grants"("recording_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_organization_id_name_key" ON "retention_policies"("organization_id", "name");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_object_type_object_id_idx" ON "audit_logs"("object_type", "object_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "configuration_versions_server_id_created_at_idx" ON "configuration_versions"("server_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "configuration_versions_server_id_version_key" ON "configuration_versions"("server_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_organization_id_key_key" ON "system_settings"("organization_id", "key");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_site_access" ADD CONSTRAINT "user_site_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_site_access" ADD CONSTRAINT "user_site_access_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asterisk_servers" ADD CONSTRAINT "asterisk_servers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asterisk_servers" ADD CONSTRAINT "asterisk_servers_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pbxs" ADD CONSTRAINT "pbxs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pbxs" ADD CONSTRAINT "pbxs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pbxs" ADD CONSTRAINT "pbxs_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pbxs" ADD CONSTRAINT "pbxs_recording_policy_id_fkey" FOREIGN KEY ("recording_policy_id") REFERENCES "recording_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_trunks" ADD CONSTRAINT "sip_trunks_pbx_id_fkey" FOREIGN KEY ("pbx_id") REFERENCES "pbxs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_trunks" ADD CONSTRAINT "sip_trunks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "trunk_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_trunks" ADD CONSTRAINT "sip_trunks_recording_policy_id_fkey" FOREIGN KEY ("recording_policy_id") REFERENCES "recording_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_transports" ADD CONSTRAINT "sip_transports_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_endpoints" ADD CONSTRAINT "sip_endpoints_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_endpoints" ADD CONSTRAINT "sip_endpoints_managed_by_trunk_id_fkey" FOREIGN KEY ("managed_by_trunk_id") REFERENCES "sip_trunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_aors" ADD CONSTRAINT "sip_aors_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_contacts" ADD CONSTRAINT "sip_contacts_aor_id_fkey" FOREIGN KEY ("aor_id") REFERENCES "sip_aors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_auths" ADD CONSTRAINT "sip_auths_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_identifies" ADD CONSTRAINT "sip_identifies_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_registrations" ADD CONSTRAINT "sip_registrations_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_domain_aliases" ADD CONSTRAINT "sip_domain_aliases_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sip_globals" ADD CONSTRAINT "sip_globals_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sorcery_mappings" ADD CONSTRAINT "sorcery_mappings_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_policies" ADD CONSTRAINT "recording_policies_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_pbx_id_fkey" FOREIGN KEY ("pbx_id") REFERENCES "pbxs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_egress_trunk_id_fkey" FOREIGN KEY ("egress_trunk_id") REFERENCES "sip_trunks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_call_type_id_fkey" FOREIGN KEY ("call_type_id") REFERENCES "call_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_recording_policy_id_fkey" FOREIGN KEY ("recording_policy_id") REFERENCES "recording_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_patterns" ADD CONSTRAINT "route_patterns_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_patterns" ADD CONSTRAINT "route_patterns_recording_policy_id_fkey" FOREIGN KEY ("recording_policy_id") REFERENCES "recording_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialplan_contexts" ADD CONSTRAINT "dialplan_contexts_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialplan_extensions" ADD CONSTRAINT "dialplan_extensions_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "dialplan_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialplan_priorities" ADD CONSTRAINT "dialplan_priorities_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "dialplan_extensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions_dir" ADD CONSTRAINT "extensions_dir_pbx_id_fkey" FOREIGN KEY ("pbx_id") REFERENCES "pbxs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cdr_records" ADD CONSTRAINT "cdr_records_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cel_records" ADD CONSTRAINT "cel_records_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_source_pbx_id_fkey" FOREIGN KEY ("source_pbx_id") REFERENCES "pbxs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_destination_pbx_id_fkey" FOREIGN KEY ("destination_pbx_id") REFERENCES "pbxs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_trunk_id_fkey" FOREIGN KEY ("trunk_id") REFERENCES "sip_trunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_route_pattern_id_fkey" FOREIGN KEY ("route_pattern_id") REFERENCES "route_patterns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_call_type_id_fkey" FOREIGN KEY ("call_type_id") REFERENCES "call_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_tags" ADD CONSTRAINT "recording_tags_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_notes" ADD CONSTRAINT "recording_notes_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_access_grants" ADD CONSTRAINT "recording_access_grants_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_access_grants" ADD CONSTRAINT "recording_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "asterisk_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

