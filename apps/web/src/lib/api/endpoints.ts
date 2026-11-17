import { api } from './client';
import type { CatalogOption, Params, PjsipKind, PjsipObject } from './types';

export type CatalogObject = 'endpoint' | 'aor' | 'auth' | 'identify' | 'transport' | 'registration';
export const KIND_OBJECT: Record<PjsipKind, CatalogObject> = {
  endpoints: 'endpoint', aors: 'aor', auths: 'auth', identifies: 'identify', transports: 'transport', registrations: 'registration',
};

export const pjsipApi = {
  list: (kind: PjsipKind, serverId: string) => api.get<PjsipObject[]>(`/pjsip/${kind}`, { serverId }),
  catalog: (object: CatalogObject, serverId: string) => api.get<{ asteriskMajor: number; options: CatalogOption[] }>('/pjsip/catalog', { object, serverId }),
  create: (kind: PjsipKind, body: Record<string, unknown>) => api.post<PjsipObject & { warnings?: Array<{ message: string }>; note?: string }>(`/pjsip/${kind}`, body),
  update: (kind: PjsipKind, id: string, body: Record<string, unknown>) => api.put<PjsipObject & { warnings?: Array<{ message: string }>; note?: string }>(`/pjsip/${kind}/${id}`, body),
  remove: (kind: PjsipKind, id: string) => api.del(`/pjsip/${kind}/${id}`),
};

/** Render a PJSIP object as the INI section Asterisk would see (display only). */
export function renderIni(type: CatalogObject, name: string, params: Params, extra: Params = {}): string {
  const lines = [`[${name}]`, `type=${type}`];
  for (const [k, v] of Object.entries({ ...extra, ...params })) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}=${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`);
  }
  return lines.join('\n');
}
