import { api } from './client';
import type { CallType, ClassificationRule, DialplanContext, PatternListItem, RecordingPolicy, Route, RouteInput, RouteTestResult } from './types';

export const routeApi = {
  list: () => api.get<Route[]>('/routes'),
  get: (id: string) => api.get<Route>(`/routes/${id}`),
  create: (b: RouteInput) => api.post<Route>('/routes', b),
  update: (id: string, b: RouteInput) => api.put<Route>(`/routes/${id}`, b),
  remove: (id: string) => api.del(`/routes/${id}`),
  patterns: () => api.get<PatternListItem[]>('/route-patterns'),
  test: (number: string, pbxId: string) => api.post<RouteTestResult>('/route-patterns/test', { number, pbxId }),
  patternStats: (id: string, from?: string, to?: string) => api.get<{ pattern: { pattern: string; route: string }; totalCalls: number; inbound: number; outbound: number; answered: number; failed: number; totalDurationSec: number; averageDurationSec: number; recordings: number }>(`/route-patterns/${id}/stats`, { from, to }),
  callTypes: () => api.get<CallType[]>('/call-types'),
  createCallType: (b: { code: string; name: string; color?: string | null }) => api.post<CallType>('/call-types', b),
  policies: () => api.get<RecordingPolicy[]>('/recording-policies'),
  rules: () => api.get<ClassificationRule[]>('/classification-rules'),
  createRule: (b: Omit<ClassificationRule, 'id'>) => api.post<ClassificationRule>('/classification-rules', b),
  updateRule: (id: string, b: Omit<ClassificationRule, 'id'>) => api.put<ClassificationRule>(`/classification-rules/${id}`, b),
  removeRule: (id: string) => api.del(`/classification-rules/${id}`),
  testRules: (ctx: Record<string, unknown>) => api.post<{ callTypeCode: string; answerStatus: string; direction: string; routeId?: string | null; tags: string[]; matchedRuleIds: string[] }>('/classification-rules/test', ctx),
  dialplans: (serverId: string) => api.get<DialplanContext[]>('/dialplans', { serverId }),
  createDialplan: (b: unknown) => api.post<DialplanContext>('/dialplans', b),
  updateDialplan: (id: string, b: unknown) => api.put<DialplanContext>(`/dialplans/${id}`, b),
  removeDialplan: (id: string) => api.del(`/dialplans/${id}`),
};
