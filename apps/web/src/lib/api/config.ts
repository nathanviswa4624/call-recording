import { api } from './client';
import type { ApplyIssue, ApplyResult, ConfigDiffResult, ConfigVersion, ConfigVersionDetail, PendingChanges } from './types';

export const configApi = {
  pending: (serverId: string) => api.get<PendingChanges>('/config/pending', { serverId }),
  validate: (serverId: string) => api.post<{ ok: boolean; issues: ApplyIssue[] }>('/config/validate', { serverId }),
  apply: (serverId: string, summary?: string) => api.post<ApplyResult>('/config/apply', { serverId, summary }),
  previewDialplan: (serverId: string) => api.get<{ text: string; issues: ApplyIssue[]; contexts: string[] }>('/config/preview/dialplan', { serverId }),
  versions: (serverId: string) => api.get<ConfigVersion[]>('/config/versions', { serverId }),
  version: (id: string) => api.get<ConfigVersionDetail>(`/config/versions/${id}`),
  diff: (a: string, b: string) => api.get<ConfigDiffResult>(`/config/versions/${a}/diff/${b}`),
  rollback: (id: string) => api.post<ApplyResult>(`/config/versions/${id}/rollback`, {}),
};
