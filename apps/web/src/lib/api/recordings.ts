import { api } from './client';
import { filtersToQuery, type CallFilters } from './calls';
import type { Page, RecordingDetail, RecordingRow } from './types';

export type Channel = 'mixed' | 'caller' | 'callee' | 'mp3';

export const recordingApi = {
  list: (f: CallFilters) => api.get<Page<RecordingRow>>('/recordings', filtersToQuery(f)),
  get: (id: string) => api.get<RecordingDetail>(`/recordings/${id}`),
  /** Short-lived signed URL for <audio>; the session token never appears in a URL. */
  streamUrl: (id: string, channel: Channel = 'mixed') => api.post<{ url: string; expiresAt: string }>(`/recordings/${id}/media-token`, { purpose: 'stream', channel }),
  downloadUrl: (id: string, mp3 = false) => api.post<{ url: string; expiresAt: string }>(`/recordings/${id}/media-token`, { purpose: 'download', channel: mp3 ? 'mp3' : 'original' }),
  addTag: (id: string, tag: string) => api.post(`/recordings/${id}/tags`, { tag }),
  removeTag: (id: string, tag: string) => api.del(`/recordings/${id}/tags/${encodeURIComponent(tag)}`),
  addNote: (id: string, body: string) => api.post(`/recordings/${id}/notes`, { body }),
  remove: (id: string) => api.del(`/recordings/${id}`),
};
