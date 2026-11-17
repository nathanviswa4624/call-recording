'use client';
import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { AuthProvider } from '@/lib/auth';
import { ServerProvider } from '@/lib/server-context';
import { ToastProvider } from '@/components/ui/feedback';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    queryCache: new QueryCache(),
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Never retry auth/permission/validation failures.
        retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
      },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <ServerProvider>{children}</ServerProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
