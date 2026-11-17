import { api } from './client';
import type { Pbx, Site, TrunkTemplate } from './types';

export interface PbxInput {
  siteId: string; serverId: string; name: string; code: string; description?: string | null; vendor: string; host: string; port: number;
  protocol: 'udp' | 'tcp' | 'tls'; sipMode: 'PEER' | 'REGISTER_OUTBOUND' | 'ACCEPT_REGISTRATION'; authMode: 'NONE' | 'IP' | 'USERPASS';
  inboundContext: string; outboundContext?: string | null; recordingPolicyId?: string | null; enabled: boolean;
}

export const pbxApi = {
  list: () => api.get<Pbx[]>('/pbxs'),
  get: (id: string) => api.get<Pbx & { trunks: import('./types').Trunk[] }>(`/pbxs/${id}`),
  create: (b: PbxInput) => api.post<Pbx>('/pbxs', b),
  update: (id: string, b: Partial<PbxInput>) => api.patch<Pbx>(`/pbxs/${id}`, b),
  remove: (id: string) => api.del(`/pbxs/${id}`),
  sites: () => api.get<Site[]>('/sites'),
  templates: () => api.get<TrunkTemplate[]>('/trunk-templates'),
};
