import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, api, getAccessToken, setSession } from '@/lib/api/client';
import { LoginForm, loginErrorMessage } from '@/components/domain/login-form';
import { jsonResponse } from './utils';

afterEach(() => { vi.restoreAllMocks(); setSession(null); document.cookie = 'ech_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'; });

describe('LoginForm', () => {
  it('requires both fields before calling the API', async () => {
    const onLogin = vi.fn();
    render(<LoginForm onLogin={onLogin} onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter your username and password/i);
  });

  it('shows a generic message for invalid credentials and clears the password', async () => {
    const onLogin = vi.fn().mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Invalid username or password'));
    render(<LoginForm onLogin={onLogin} onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
  });

  it('calls onSuccess after a successful login', async () => {
    const onSuccess = vi.fn();
    render(<LoginForm onLogin={vi.fn().mockResolvedValue(undefined)} onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Correct-Horse-9');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('switches to the MFA state when the backend requires MFA', async () => {
    render(<LoginForm onLogin={vi.fn().mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'MFA verification required', { mfaRequired: true }))} onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/multi-factor authentication required/i)).toBeInTheDocument();
  });

  it('maps rate limiting, lockout and outages to safe messages', () => {
    expect(loginErrorMessage(new ApiError(429, 'RATE_LIMITED', 'x')).message).toMatch(/too many/i);
    expect(loginErrorMessage(new ApiError(401, 'UNAUTHENTICATED', 'Account temporarily locked due to repeated failed logins')).message).toMatch(/locked/);
    expect(loginErrorMessage(new ApiError(503, 'X', 'stack trace here')).message).not.toMatch(/stack/);
    expect(loginErrorMessage(new TypeError('Failed to fetch')).message).toMatch(/could not reach/i);
  });
});

describe('API client session handling', () => {
  it('keeps the access token in memory only and attaches it as a Bearer header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    setSession({ accessToken: 'tok-123', user: { id: 'u', name: 'U', permissions: [], organizationId: 'o' } });
    await api.get('/auth/me');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-123');
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('tok-123');
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-123');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('tok-123');
  });

  it('refreshes once on 401 using the CSRF cookie, then retries the request', async () => {
    document.cookie = 'ech_csrf=csrf-abc; path=/';
    setSession({ accessToken: 'expired', user: { id: 'u', name: 'U', permissions: [], organizationId: 'o' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'fresh', user: { id: 'u', name: 'U', permissions: [], organizationId: 'o' } }))
      .mockResolvedValueOnce(jsonResponse({ value: 42 }));
    await expect(api.get<{ value: number }>('/calls')).resolves.toEqual({ value: 42 });
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/auth/refresh');
    expect(((fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>)['x-csrf-token']).toBe('csrf-abc');
    expect(((fetchMock.mock.calls[2]![1] as RequestInit).headers as Record<string, string>)['authorization']).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('surfaces backend error codes and request ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'FORBIDDEN', message: 'nope', requestId: 'req-1' } }, 403));
    const err = await api.get('/audit').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'req-1' });
  });
});
