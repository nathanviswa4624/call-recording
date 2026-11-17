import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PERMISSIONS as P } from '@echelons/shared';
import { AudioPlayer } from '@/components/domain/audio-player';
import { RollbackButton } from '@/components/domain/version-actions';
import { CliConsole } from '@/components/domain/cli-console';
import { SearchFilters, filtersFromParams, filtersToParams } from '@/components/domain/search-filters';
import { filtersToQuery } from '@/lib/api/calls';
import { PermissionGuard } from '@/lib/auth';
import { NAV } from '@/components/shell/nav';
import { diffSummary, lineDiff } from '@/components/domain/config-diff';
import { toCsv } from '@/lib/format';
import { setSession } from '@/lib/api/client';
import type { ConfigVersion } from '@/lib/api/types';
import { jsonResponse, renderWithAuth } from './utils';

afterEach(() => { vi.restoreAllMocks(); setSession(null); });

describe('recording search filters', () => {
  it('round-trips filters through the URL and drops empty values', () => {
    const p = filtersToParams({ caller: '9715', direction: ['OUTBOUND'], routePatternId: ['a'], minDuration: 30, destination: '', cursor: 'x', limit: 50 });
    expect(p.toString()).toBe('caller=9715&direction=OUTBOUND&routePatternId=a&minDuration=30');
    expect(filtersFromParams(p)).toEqual({ caller: '9715', direction: ['OUTBOUND'], routePatternId: ['a'], minDuration: 30 });
    expect(filtersFromParams(new URLSearchParams('minDuration=abc&evil=1'))).toEqual({});
    expect(filtersToQuery({ caller: '', status: [], extension: '201' })).toEqual({ extension: '201' });
  });

  it('submits combined filters (spec example: outbound, Avaya, pattern, date range, >30s)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse([]));
    const onApply = vi.fn();
    renderWithAuth(<SearchFilters value={{ direction: ['OUTBOUND'], from: '2026-11-01T00:00:00.000Z', to: '2026-11-15T23:59:00.000Z' }} onApply={onApply} />, [P.CALLS_VIEW]);
    await userEvent.click(screen.getByRole('button', { name: /more filters/i }));
    await userEvent.type(screen.getByLabelText(/min duration/i), '30');
    await userEvent.type(screen.getByLabelText(/dialled matches pattern/i), '9XXXXXXXXXX');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ direction: ['OUTBOUND'], minDuration: 30, destinationPattern: '9XXXXXXXXXX', from: '2026-11-01T00:00:00.000Z' }));
  });
});

describe('recording player permissions & secure streaming', () => {
  it('streams via a signed media URL (no session token in the URL) and hides download without permission', async () => {
    setSession({ accessToken: 'session-secret', user: { id: 'u', name: 'U', permissions: [], organizationId: 'o' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ url: '/api/recordings/r1/stream?channel=mixed&t=signed.token', expiresAt: new Date().toISOString() }));
    const { container } = renderWithAuth(<AudioPlayer recordingId="r1" channels={{ mixed: true, caller: false, callee: false }} canDownload={false} />, [P.RECORDINGS_VIEW]);
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    const audio = container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/api/recordings/r1/stream?channel=mixed&t=signed.token');
    expect(audio.getAttribute('src')).not.toContain('session-secret');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/recordings/r1/media-token');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ purpose: 'stream', channel: 'mixed' });
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.getByLabelText(/playback speed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^channel$/i)).toBeNull();
  });

  it('shows download and channel selection when permitted and available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ url: '/api/recordings/r1/stream?t=x', expiresAt: '' }));
    renderWithAuth(<AudioPlayer recordingId="r1" channels={{ mixed: true, caller: true, callee: true }} canDownload />, [P.RECORDINGS_VIEW, P.RECORDINGS_DOWNLOAD]);
    expect(await screen.findByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^channel$/i)).toHaveTextContent(/caller channel/i);
    expect(screen.getByLabelText(/playback speed/i)).toHaveTextContent('0.5x');
  });
});

describe('configuration rollback UI', () => {
  const v: ConfigVersion = { id: 'v7', version: 7, status: 'APPLIED', summary: 'Add Avaya', changes: null, error: null, createdAt: '', appliedAt: '', changedBy: null };

  it('is hidden without system.manage', () => {
    renderWithAuth(<RollbackButton version={v} rollback={vi.fn()} />, [P.CONFIG_VIEW]);
    expect(screen.queryByRole('button', { name: /rollback/i })).toBeNull();
  });

  it('requires typing the version, then calls the transactional rollback API and shows the result', async () => {
    const rollback = vi.fn().mockResolvedValue({ versionId: 'v9', version: 9, status: 'APPLIED', issues: [], steps: [], restartRequired: false });
    renderWithAuth(<RollbackButton version={v} rollback={rollback} />, [P.SYSTEM_MANAGE]);
    await userEvent.click(screen.getByRole('button', { name: /rollback/i }));
    const confirm = screen.getByRole('button', { name: /^roll back$/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/confirmation text/i), 'v7');
    await userEvent.click(confirm);
    expect(rollback).toHaveBeenCalledWith('v7');
    expect(await screen.findByText(/configuration v9 applied/i)).toBeInTheDocument();
  });

  it('cannot roll back to a failed version', () => {
    renderWithAuth(<RollbackButton version={{ ...v, status: 'FAILED' }} rollback={vi.fn()} />, [P.SYSTEM_MANAGE]);
    expect(screen.getByRole('button', { name: /rollback/i })).toBeDisabled();
  });

  it('summarises diffs as added / removed / changed', () => {
    const s = diffSummary({ from: 1, to: 2, tables: { ps_endpoints: { added: ['AVAYA'], removed: ['OLD'], changed: [{ id: 'MITEL', fields: [{ field: 'transport', from: 'transport-udp', to: 'transport-tcp' }] }] } }, dialplan: { from: 'a', to: 'b' }, transports: { from: '', to: '' } });
    expect(s.map((x) => `${x.op} ${x.text}`)).toEqual(['+ Added endpoint AVAYA', '- Removed endpoint OLD', '~ Changed endpoint MITEL: transport transport-udp → transport-tcp', '~ Changed generated dialplan']);
    expect(lineDiff('a\nb\nc', 'a\nc\nd').map((l) => l.op + l.line)).toEqual([' a', '-b', ' c', '+d']);
  });
});

describe('permission-based rendering', () => {
  it('PermissionGuard renders children only when all permissions are held', () => {
    renderWithAuth(<><PermissionGuard all={[P.CLI_ACCESS]}><span>cli</span></PermissionGuard><PermissionGuard all={[P.CALLS_VIEW]} fallback={<span>no</span>}><span>calls</span></PermissionGuard></>, [P.CALLS_VIEW]);
    expect(screen.queryByText('cli')).toBeNull();
    expect(screen.getByText('calls')).toBeInTheDocument();
  });

  it('agent navigation exposes calls/recordings but not configuration, CLI or admin', () => {
    const agent = new Set<string>([P.RECORDINGS_VIEW, P.RECORDINGS_DOWNLOAD, P.CALLS_VIEW]);
    const visible = NAV.flatMap((s) => s.items).filter((i) => !i.planned && (!i.any || i.any.some((p) => agent.has(p)))).map((i) => i.href);
    expect(visible).toEqual(expect.arrayContaining(['/calls', '/recordings', '/calls/live']));
    for (const forbidden of ['/asterisk/cli', '/trunks', '/admin/users', '/admin/audit', '/config/versions', '/routing/routes']) expect(visible).not.toContain(forbidden);
  });

  it('CLI console blocks shell and non-allowlisted commands before any request', async () => {
    const run = vi.fn().mockResolvedValue('Asterisk 22.1.0');
    renderWithAuth(<CliConsole commands={[{ id: 'v', tier: 'read', example: 'core show version', description: 'Version' }]} allowActive={false} run={run} />, [P.CLI_ACCESS]);
    for (const cmd of ['bash', 'sudo rm -rf /', 'core show version; systemctl stop asterisk', 'pjsip reload']) {
      await userEvent.clear(screen.getByLabelText('Command'));
      await userEvent.type(screen.getByLabelText('Command'), cmd);
      await userEvent.click(screen.getByRole('button', { name: /run/i }));
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected/i);
    }
    expect(run).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Command'));
    await userEvent.type(screen.getByLabelText('Command'), 'core show version');
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(run).toHaveBeenCalledWith('core show version');
    expect(await screen.findByText('Asterisk 22.1.0')).toBeInTheDocument();
  });

  it('CSV export neutralises spreadsheet formulas', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'x,y' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }])).toBe('A,B\r\n"\'=HYPERLINK(""x"")","x,y"');
  });
});
