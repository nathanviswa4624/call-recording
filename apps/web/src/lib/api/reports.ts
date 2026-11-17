import { api } from './client';
import { filtersToQuery, type CallFilters } from './calls';
import type { DashboardData, ReportRow, SystemHealth } from './types';

export type ReportKind = 'agents' | 'pbx' | 'routes' | 'call-types' | 'trunks' | 'extensions';

export const reportApi = {
  dashboard: (days = 14) => api.get<DashboardData>('/reports/dashboard', { days }),
  report: (kind: ReportKind, f: CallFilters) => api.get<{ kind: ReportKind; rows: ReportRow[] }>(`/reports/${kind}`, filtersToQuery(f)),
  health: () => api.get<SystemHealth>('/system/health'),
};
