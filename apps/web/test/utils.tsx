import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/feedback';

export function renderWithAuth(ui: ReactNode, permissions: string[] = []) {
  const set = new Set(permissions);
  const value: AuthContextValue = {
    status: 'authenticated',
    user: { id: 'u1', name: 'Test User', permissions, organizationId: 'o1' },
    organizationName: 'Test Org',
    can: (...p) => p.every((x) => set.has(x)),
    canAny: (...p) => p.some((x) => set.has(x)),
    login: async () => undefined,
    logout: async () => undefined,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthContext.Provider value={value}>{ui}</AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
