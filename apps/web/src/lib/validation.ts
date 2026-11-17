/**
 * Client-side validation mirroring the backend zod schemas
 * (apps/backend/src/modules/{trunks,routing,pjsip}). The backend stays
 * authoritative; these exist for immediate feedback and identical rules.
 * Pattern/IP checks reuse @echelons/shared so they are the SAME code the
 * backend and dialplan compiler use.
 */
import { z } from 'zod';
import { isIpOrCidr, isValidPattern } from '@echelons/shared';

export const OBJECT_NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}$/, 'Letters, digits, _ . - (max 40, must start with a letter or digit)');
export const CONTEXT_NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/, 'Letters, digits, _ - (max 80)');
export const PBX_CODE = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_\-]{0,31}$/, 'Letters, digits, _ - (max 32); used in dialplan and recording paths');
const HOST = z.string().min(1, 'Required').max(253).refine((h) => (isIpOrCidr(h) && !h.includes('/')) || /^[A-Za-z0-9.-]+$/.test(h), 'Must be an IP address or hostname');
const PORT = z.coerce.number({ invalid_type_error: 'Must be a number' }).int().min(1, '1–65535').max(65535, '1–65535');

export const VENDORS = ['Avaya', 'Mitel', 'Cisco', 'Alcatel-Lucent', 'NEC', 'Panasonic', '3CX', 'Yeastar', 'Generic SIP', 'Other'] as const;

export const pbxInfoSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  code: PBX_CODE,
  vendor: z.string().min(1, 'Required'),
  model: z.string().max(80).optional(),
  host: HOST,
  port: PORT,
  protocol: z.enum(['udp', 'tcp', 'tls']),
  description: z.string().max(500).optional(),
  siteId: z.string().uuid('Select a site'),
});

export const transportSchema = z.object({
  mode: z.enum(['existing', 'new']),
  existingName: z.string().optional(),
  name: OBJECT_NAME.optional(),
  protocol: z.enum(['udp', 'tcp', 'tls']),
  bindAddress: z.string().min(1).max(64),
  bindPort: PORT,
  externalAddress: z.string().max(120).optional(),
  localNet: z.string().optional().refine((v) => !v || v.split(',').map((s) => s.trim()).filter(Boolean).every(isIpOrCidr), 'Comma-separated CIDRs, e.g. 192.168.0.0/16'),
  certFile: z.string().max(255).optional(),
  privKeyFile: z.string().max(255).optional(),
}).superRefine((t, ctx) => {
  if (t.mode === 'existing' && !t.existingName) ctx.addIssue({ code: 'custom', path: ['existingName'], message: 'Select a transport' });
  if (t.mode === 'new' && !t.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Required' });
  if (t.mode === 'new' && t.protocol === 'tls' && (!t.certFile || !t.privKeyFile)) ctx.addIssue({ code: 'custom', path: ['certFile'], message: 'TLS requires a certificate and private key path' });
});

export const trunkFormSchema = z.object({
  name: OBJECT_NAME,
  templateId: z.string().optional(),
  host: HOST,
  port: PORT,
  protocol: z.enum(['udp', 'tcp', 'tls']),
  transportName: OBJECT_NAME,
  authMode: z.enum(['NONE', 'IP', 'USERPASS']),
  sipMode: z.enum(['PEER', 'REGISTER_OUTBOUND', 'ACCEPT_REGISTRATION']),
  username: z.string().max(80).optional(),
  password: z.string().max(128).optional(),
  /** true when editing a trunk that already has a stored password */
  hasStoredPassword: z.boolean().default(false),
  realm: z.string().max(80).optional(),
  remoteDomain: z.string().max(253).optional(),
  outboundProxy: z.string().max(255).optional(),
  codecs: z.string().regex(/^[a-z0-9_]+(,[a-z0-9_]+)*$/i, 'Comma-separated codecs, e.g. ulaw,alaw').or(z.literal('')),
  dtmfMode: z.enum(['rfc4733', 'inband', 'info', 'auto', 'auto_info']),
  inboundContext: CONTEXT_NAME,
  matchNetworks: z.string().optional().refine((v) => !v || v.split(',').map((s) => s.trim()).filter(Boolean).every(isIpOrCidr), 'Comma-separated IPs or CIDRs'),
  qualifyFrequency: z.coerce.number().int().min(0).max(86400),
}).superRefine((t, ctx) => {
  if (t.authMode === 'USERPASS' && !t.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Username is required for username/password authentication' });
  if (t.authMode === 'USERPASS' && !t.password && !t.hasStoredPassword) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password is required' });
  if (t.sipMode !== 'PEER' && t.authMode !== 'USERPASS') ctx.addIssue({ code: 'custom', path: ['authMode'], message: 'Registration requires username/password authentication' });
});
export type TrunkForm = z.infer<typeof trunkFormSchema>;

export const patternRowSchema = z.object({
  pattern: z.string().min(1, 'Required').max(80).refine(isValidPattern, 'Invalid Asterisk pattern (X, Z, N, [1-5], . and ! at the end)'),
  prefix: z.string().regex(/^[0-9*#+]{0,10}$/, 'Digits only').optional(),
  stripDigits: z.coerce.number().int().min(0).max(40),
  prepend: z.string().regex(/^[0-9*#+]{0,20}$/, 'Digits, *, #, + only').optional(),
  enabled: z.boolean().default(true),
});

export const routeFormSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  pbxId: z.string().uuid('Select a PBX'),
  direction: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT']),
  priority: z.coerce.number().int().min(0).max(9999),
  egressKind: z.enum(['TRUNK', 'CONTEXT', 'HANGUP']),
  egressTrunkId: z.string().optional(),
  egressContext: z.string().optional(),
  callTypeId: z.string().optional(),
  recordingPolicyId: z.string().optional(),
  callerIdNumber: z.string().regex(/^(\+?[0-9]{1,32})?$/, 'Digits only').optional(),
  dialTimeout: z.coerce.number().int().min(1).max(3600),
  enabled: z.boolean(),
  patterns: z.array(patternRowSchema).min(1, 'Add at least one pattern'),
}).superRefine((r, ctx) => {
  if (r.egressKind === 'TRUNK' && !r.egressTrunkId) ctx.addIssue({ code: 'custom', path: ['egressTrunkId'], message: 'Select the egress trunk' });
  if (r.egressKind === 'CONTEXT' && !(r.egressContext && /^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}$/.test(r.egressContext))) ctx.addIssue({ code: 'custom', path: ['egressContext'], message: 'Enter a valid dialplan context' });
});
export type RouteForm = z.infer<typeof routeFormSchema>;

export const passwordPolicy = (pw: string): string | null => {
  if (pw.length < 12) return 'At least 12 characters';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return classes < 3 ? 'Use 3 of: lowercase, uppercase, digit, symbol' : null;
};

/** Flatten zod issues into { "field.path": "message" } for form display. */
export function fieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join('.') || '_';
    out[k] ??= i.message;
  }
  return out;
}

export function validate<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): { ok: true; data: T } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: fieldErrors(r.error) };
}
