import { api } from './client';
import type { AuditEntry, Role, User } from './types';

export interface AuditFilters { userId?: string; objectType?: string; action?: string; ip?: string; from?: string; to?: string; before?: string; limit?: number }

export const auditApi = {
  list: (f: AuditFilters) => api.get<AuditEntry[]>('/audit', f as Record<string, string | number | undefined>),
};

export const userApi = {
  list: () => api.get<User[]>('/users'),
  create: (b: unknown) => api.post<User>('/users', b),
  update: (id: string, b: unknown) => api.put<User>(`/users/${id}`, b),
  roles: () => api.get<Role[]>('/roles'),
  createRole: (b: { code: string; name: string; description?: string | null; permissions: string[] }) => api.post<Role>('/roles', b),
  permissions: () => api.get<Array<{ id: string; code: string; description: string | null }>>('/permissions'),
};

export const setupApi = {
  status: () => api.get<{ installed: boolean }>('/setup/status'),
  test: () => api.post<Record<string, { ok: boolean; detail?: string }>>('/setup/test', {}),
  complete: (b: unknown) => api.post<{ organizationId: string; siteId: string; serverId: string; adminUserId: string }>('/setup/complete', b),
};
