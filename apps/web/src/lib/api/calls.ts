import { api, type Query } from './client';
import type { CallDetail, CallRow, CallSummary, LiveCall, Page } from './types';

/** Filters accepted by GET /calls and GET /recordings (backend callFilterSchema). */
export interface CallFilters {
  from?: string; to?: string; timeOfDay?: string; caller?: string; destination?: string; number?: string; extension?: string;
  pbxId?: string[]; trunkId?: string[]; routeId?: string[]; routePatternId?: string[]; destinationPattern?: string; callTypeId?: string[];
  direction?: string[]; status?: string[]; minDuration?: number; maxDuration?: number; department?: string; queue?: string; campaign?: string;
  recordingId?: string; uniqueId?: string; hasRecording?: 'true' | 'false'; tag?: string; limit?: number; cursor?: string;
}

/** Drop empty values so URLs stay clean and the backend never sees "". */
export function filtersToQuery(f: CallFilters): Query {
  const q: Query = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    q[k] = v as Query[string];
  }
  return q;
}

export const callApi = {
  list: (f: CallFilters) => api.get<Page<CallRow>>('/calls', filtersToQuery(f)),
  summary: (f: CallFilters) => api.get<CallSummary>('/calls/summary', filtersToQuery({ ...f, cursor: undefined, limit: undefined })),
  get: (id: string) => api.get<CallDetail>(`/calls/${id}`),
  live: () => api.get<{ calls: LiveCall[]; errors: Array<{ server: string; error: string }> }>('/calls/live'),
};
