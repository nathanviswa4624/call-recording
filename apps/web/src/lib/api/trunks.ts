import { api } from './client';
import type { Trunk, TrunkInput, TrunkTestResults } from './types';

export const trunkApi = {
  list: () => api.get<Trunk[]>('/trunks'),
  forPbx: (pbxId: string) => api.get<Trunk[]>(`/pbxs/${pbxId}/trunks`),
  create: (pbxId: string, b: TrunkInput) => api.post<Trunk>(`/pbxs/${pbxId}/trunks`, b),
  update: (id: string, b: TrunkInput) => api.put<Trunk>(`/trunks/${id}`, b),
  remove: (id: string) => api.del(`/trunks/${id}`),
  test: (id: string, testNumber?: string) => api.post<{ trunk: string; ok: boolean; results: TrunkTestResults }>(`/trunks/${id}/test`, testNumber ? { testNumber } : {}),
};
