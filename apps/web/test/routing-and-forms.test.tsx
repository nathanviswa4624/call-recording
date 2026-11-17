import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteTester } from '@/components/domain/route-tester';
import { initialWizardState, newRoute, validateStep } from '@/components/domain/pbx-wizard-logic';
import { emptyTrunkForm, formToTrunkInput, trunkToForm } from '@/components/domain/trunk-form';
import { matchingOrder } from '@/components/domain/route-editor';
import { trunkFormSchema, validate } from '@/lib/validation';
import type { Pbx, Route, RouteTestResult, Trunk } from '@/lib/api/types';

const PBX = { id: 'p1', name: 'Avaya HQ' } as Pbx;

describe('RouteTester', () => {
  const matched: RouteTestResult = {
    matched: true, number: '00971501234567',
    route: { id: 'r1', name: 'International Outbound', routeNumber: 3, direction: 'OUTBOUND', priority: 10 },
    pattern: { id: 'pt', pattern: '00X.' }, dialled: '971501234567', egress: { kind: 'TRUNK', trunk: 'Main SIP Trunk' },
    prefix: '00', stripDigits: 2, prepend: '', callType: { code: 'INTERNATIONAL', name: 'International' },
    recordingPolicy: { name: 'Record all calls', mode: 'ALWAYS', layout: 'MIXED', format: 'wav' },
  };

  it('sends the number and PBX to the backend matcher and shows the full decision', async () => {
    const onTest = vi.fn().mockResolvedValue(matched);
    render(<RouteTester pbxs={[PBX]} onTest={onTest} />);
    await userEvent.type(screen.getByLabelText(/dialled number/i), '00971501234567');
    await userEvent.click(screen.getByRole('button', { name: /test route/i }));
    expect(onTest).toHaveBeenCalledWith('00971501234567', 'p1');
    expect(await screen.findByText('Matched route: International Outbound')).toBeInTheDocument();
    for (const text of ['Main SIP Trunk', 'International', '971501234567']) expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Enabled · Record all calls/)).toBeInTheDocument();
  });

  it('reports "No matching route"', async () => {
    render(<RouteTester pbxs={[PBX]} onTest={vi.fn().mockResolvedValue({ matched: false, number: '555', considered: 4 })} />);
    await userEvent.type(screen.getByLabelText(/dialled number/i), '555');
    await userEvent.click(screen.getByRole('button', { name: /test route/i }));
    expect(await screen.findByText('No matching route')).toBeInTheDocument();
  });

  it('rejects input that is not a dial string without calling the API', async () => {
    const onTest = vi.fn();
    render(<RouteTester pbxs={[PBX]} onTest={onTest} />);
    await userEvent.type(screen.getByLabelText(/dialled number/i), '12;rm');
    await userEvent.click(screen.getByRole('button', { name: /test route/i }));
    expect(onTest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/digits/i);
  });
});

describe('route matching order (same precedence as the dialplan)', () => {
  it('orders by priority tier, then Asterisk specificity', () => {
    const mk = (name: string, priority: number, pattern: string, prefix = '') => ({ id: name, name, priority, enabled: true, patterns: [{ id: `${name}-p`, pattern, prefix, stripDigits: 0, prepend: null, enabled: true }] }) as unknown as Route;
    const order = matchingOrder([mk('Local', 20, 'XXXXXXXXX', '9'), mk('Mobile', 20, '5XXXXXXXX', '9'), mk('Catch-all', 10, 'X.'), mk('Disabled', 1, '7XXX')].map((r) => (r.name === 'Disabled' ? { ...r, enabled: false } : r)));
    expect(order.map((o) => o.route.name)).toEqual(['Catch-all', 'Mobile', 'Local']);
  });
});

describe('PBX wizard validation', () => {
  it('requires PBX identity fields and a valid address', () => {
    const s = initialWizardState();
    const e = validateStep(0, { ...s, info: { ...s.info, host: 'not an ip!', code: 'bad code' } });
    expect(e).toHaveProperty('name');
    expect(e).toHaveProperty('code');
    expect(e).toHaveProperty('host');
    expect(e).toHaveProperty('siteId');
    const ok = validateStep(0, { ...s, info: { ...s.info, name: 'Avaya', code: 'AVAYA', host: '192.168.51.10', siteId: '6f1b9c1e-7f1a-4c3e-9d2b-1a2b3c4d5e6f' } });
    expect(ok).toEqual({});
  });

  it('requires TLS certificate paths for a new TLS transport', () => {
    const s = initialWizardState();
    expect(validateStep(1, { ...s, transport: { ...s.transport, mode: 'new', protocol: 'tls', name: 'transport-tls' } })).toHaveProperty('certFile');
    expect(validateStep(1, { ...s, transport: { ...s.transport, mode: 'existing', existingName: '' } })).toHaveProperty('existingName');
    expect(validateStep(1, { ...s, transport: { ...s.transport, mode: 'new', name: 'transport-udp', localNet: '10.0.0.0/33' } })).toHaveProperty('localNet');
  });

  it('validates route patterns with the shared Asterisk pattern engine', () => {
    const s = initialWizardState();
    const bad = newRoute('OUTBOUND');
    bad.patterns = [{ pattern: '9X.X', prefix: '', stripDigits: 0, prepend: '', enabled: true }];
    bad.egressTrunkId = 'NEW';
    expect(validateStep(4, { ...s, routes: [bad] })).toHaveProperty(['routes.0.patterns.0.pattern']);
    const good = { ...bad, patterns: [{ pattern: 'XXXXXXXXXX', prefix: '9', stripDigits: 0, prepend: '', enabled: true }] };
    expect(validateStep(4, { ...s, routes: [good] })).toEqual({});
    expect(validateStep(4, { ...s, routes: [{ ...good, egressTrunkId: '' }] })).toHaveProperty(['routes.0.egressTrunkId']);
  });
});

describe('trunk form', () => {
  const base = emptyTrunkForm({ name: 'AVAYA-PBX', host: '192.168.51.10', transportName: 'transport-tcp', inboundContext: 'from-avaya' });

  it('validates authentication and registration combinations', () => {
    expect(validate(trunkFormSchema, base).ok).toBe(true);
    const r = validate(trunkFormSchema, { ...base, authMode: 'USERPASS' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors).toHaveProperty('username'); expect(r.errors).toHaveProperty('password'); }
    const reg = validate(trunkFormSchema, { ...base, sipMode: 'REGISTER_OUTBOUND' });
    expect(!reg.ok && reg.errors['authMode']).toBeTruthy();
    const badNet = validate(trunkFormSchema, { ...base, matchNetworks: '192.168.51.0/24, nonsense' });
    expect(!badNet.ok && badNet.errors['matchNetworks']).toBeTruthy();
    expect(validate(trunkFormSchema, { ...base, name: 'bad name' }).ok).toBe(false);
  });

  it('keeps a stored password when editing (password never round-trips to the browser)', () => {
    const t = { ...base, id: 't1', pbxId: 'p1', templateId: null, protocol: 'tcp', authMode: 'USERPASS', sipMode: 'PEER', username: 'rec', hasPassword: true, realm: null, remoteDomain: null, outboundContext: null, matchNetworks: [], overrides: { endpoint: { allow: 'alaw', dtmf_mode: 'info' } }, recordingPolicyId: null, enabled: true, status: 'UNKNOWN', lastRttMs: null } as unknown as Trunk;
    const form = trunkToForm(t);
    expect(form.password).toBe('');
    expect(form.hasStoredPassword).toBe(true);
    expect(validate(trunkFormSchema, form).ok).toBe(true);
    const input = formToTrunkInput(form);
    expect(input).not.toHaveProperty('password');
    expect(input.overrides.endpoint).toMatchObject({ allow: 'alaw', disallow: 'all', dtmf_mode: 'info' });
    expect(formToTrunkInput({ ...form, password: 'N3w-secret!' }).password).toBe('N3w-secret!');
  });
});
