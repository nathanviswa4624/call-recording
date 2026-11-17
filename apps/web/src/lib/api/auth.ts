import { api, request, setSession, type SessionUser } from './client';
import type { Me } from './types';

export const authApi = {
  async login(username: string, password: string) {
    const s = await request<{ accessToken: string; user: SessionUser }>('POST', '/auth/login', { body: { username, password } });
    setSession(s);
    return s.user;
  },
  async logout() {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('ech_csrf='))?.slice(9);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {} }).catch(() => undefined);
    setSession(null);
  },
  me: () => api.get<Me>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) => api.put<{ ok: true }>('/auth/password', { currentPassword, newPassword }),
};
