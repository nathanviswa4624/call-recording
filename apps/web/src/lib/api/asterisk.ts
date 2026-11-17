import { api } from './client';
import type { AsteriskServer, AsteriskStatus, CliCommand } from './types';

export type LiveKind = 'endpoints' | 'contacts' | 'registrations' | 'transports' | 'channels' | 'bridges';

export const asteriskApi = {
  servers: () => api.get<AsteriskServer[]>('/asterisk/servers'),
  status: (serverId: string) => api.get<AsteriskStatus>('/asterisk/status', { serverId }),
  live: (what: LiveKind, serverId: string) => api.get<Array<Record<string, string>>>(`/asterisk/live/${what}`, { serverId }),
  commands: () => api.get<CliCommand[]>('/asterisk/cli/commands'),
  cli: (serverId: string, command: string) => api.post<{ command: string; output: string }>('/asterisk/cli', { serverId, command }),
  reload: (serverId: string, module: string) => api.post<{ ok: boolean; output: string }>('/asterisk/reload', { serverId, module }),
};
