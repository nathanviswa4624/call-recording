/**
 * Permission codes. These are stable identifiers stored in the database;
 * roles are data, permissions are code. See docs/08-security-architecture.md §2.
 */
export const PERMISSIONS = {
  RECORDINGS_VIEW: 'recordings.view',
  RECORDINGS_DOWNLOAD: 'recordings.download',
  RECORDINGS_DELETE: 'recordings.delete',
  /** Unrestricted visibility (otherwise the agent "own/granted" filter applies). */
  RECORDINGS_VIEW_ALL: 'recordings.view_all',
  CALLS_VIEW: 'calls.view',
  CDR_VIEW: 'cdr.view',
  REPORTS_VIEW: 'reports.view',
  TRUNKS_VIEW: 'trunks.view',
  TRUNKS_CONFIGURE: 'trunks.configure',
  ENDPOINTS_VIEW: 'endpoints.view',
  ENDPOINTS_CONFIGURE: 'endpoints.configure',
  ROUTES_VIEW: 'routes.view',
  ROUTES_CONFIGURE: 'routes.configure',
  DIALPLAN_CONFIGURE: 'dialplan.configure',
  CONFIG_VIEW: 'config.view',
  USERS_MANAGE: 'users.manage',
  SYSTEM_VIEW: 'system.view',
  SYSTEM_MANAGE: 'system.manage',
  CLI_ACCESS: 'cli.access',
  CLI_UNSAFE: 'cli.unsafe',
  AUDIT_VIEW: 'audit.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

const P = PERMISSIONS;

/** Built-in roles seeded on install. Custom roles may be created from the UI. */
export const BUILTIN_ROLES: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full access to every feature including CLI and user management.',
    permissions: [...ALL_PERMISSIONS],
  },
  ADMINISTRATOR: {
    name: 'Administrator',
    description: 'Telephony configuration and recordings.',
    permissions: [
      P.RECORDINGS_VIEW, P.RECORDINGS_VIEW_ALL, P.RECORDINGS_DOWNLOAD, P.RECORDINGS_DELETE,
      P.CALLS_VIEW, P.CDR_VIEW, P.REPORTS_VIEW,
      P.TRUNKS_VIEW, P.TRUNKS_CONFIGURE, P.ENDPOINTS_VIEW, P.ENDPOINTS_CONFIGURE,
      P.ROUTES_VIEW, P.ROUTES_CONFIGURE, P.DIALPLAN_CONFIGURE, P.CONFIG_VIEW,
      P.SYSTEM_VIEW, P.AUDIT_VIEW,
    ],
  },
  SUPERVISOR: {
    name: 'Supervisor',
    description: 'Reports and recordings.',
    permissions: [
      P.RECORDINGS_VIEW, P.RECORDINGS_VIEW_ALL, P.RECORDINGS_DOWNLOAD,
      P.CALLS_VIEW, P.CDR_VIEW, P.REPORTS_VIEW,
    ],
  },
  AGENT: {
    name: 'Agent',
    description: 'Only recordings of own/assigned calls.',
    permissions: [P.RECORDINGS_VIEW, P.RECORDINGS_DOWNLOAD, P.CALLS_VIEW],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access.',
    permissions: [
      P.RECORDINGS_VIEW, P.RECORDINGS_VIEW_ALL, P.CALLS_VIEW, P.CDR_VIEW, P.REPORTS_VIEW,
      P.TRUNKS_VIEW, P.ENDPOINTS_VIEW, P.ROUTES_VIEW,
    ],
  },
};

export function hasPermission(granted: Iterable<string>, required: Permission | Permission[]): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  const req = Array.isArray(required) ? required : [required];
  return req.every((r) => set.has(r));
}

export function hasAnyPermission(granted: Iterable<string>, candidates: Permission[]): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  return candidates.some((r) => set.has(r));
}
