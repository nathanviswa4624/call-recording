/**
 * PBX setup wizard state + pure validation (unit tested). The wizard creates
 * DRAFT objects through the existing APIs; nothing is live in Asterisk until the
 * single atomic /config/apply at the last step.
 */
import { pbxInfoSchema, routeFormSchema, transportSchema, trunkFormSchema, validate, type RouteForm, type TrunkForm } from '@/lib/validation';
import { emptyTrunkForm } from './trunk-form';

export const WIZARD_STEPS = ['PBX information', 'SIP transport', 'SIP trunk', 'PJSIP objects', 'Routes', 'Test', 'Apply'] as const;

export interface PbxInfo { name: string; code: string; vendor: string; model: string; host: string; port: number; protocol: 'udp' | 'tcp' | 'tls'; description: string; siteId: string }
export interface TransportStep {
  mode: 'existing' | 'new'; existingName: string; name: string; protocol: 'udp' | 'tcp' | 'tls'; bindAddress: string; bindPort: number;
  externalAddress: string; localNet: string; certFile: string; privKeyFile: string;
}
export interface WizardRoute extends Omit<RouteForm, 'patterns'> { key: string; patterns: RouteForm['patterns'] }

export interface WizardState {
  info: PbxInfo;
  transport: TransportStep;
  trunk: TrunkForm;
  routes: WizardRoute[];
  /** IDs of objects already created (makes "Save drafts" safely re-runnable). */
  created: { transport?: string; pbxId?: string; trunkId?: string; routes: Record<string, string> };
}

export function initialWizardState(siteId = ''): WizardState {
  return {
    info: { name: '', code: '', vendor: 'Avaya', model: '', host: '', port: 5060, protocol: 'udp', description: '', siteId },
    transport: { mode: 'existing', existingName: '', name: 'transport-udp', protocol: 'udp', bindAddress: '0.0.0.0', bindPort: 5060, externalAddress: '', localNet: '', certFile: '', privKeyFile: '' },
    trunk: emptyTrunkForm(),
    routes: [],
    created: { routes: {} },
  };
}

export function newRoute(direction: WizardRoute['direction'], pbxId = ''): WizardRoute {
  return {
    key: Math.random().toString(36).slice(2), name: direction === 'INBOUND' ? 'Inbound to extensions' : 'Outbound', pbxId, direction, priority: 100,
    egressKind: direction === 'INBOUND' || direction === 'INTERNAL' ? 'CONTEXT' : 'TRUNK', egressTrunkId: '', egressContext: '', callTypeId: '',
    recordingPolicyId: '', callerIdNumber: '', dialTimeout: 60, enabled: true,
    patterns: [{ pattern: direction === 'INBOUND' ? 'XXXX' : 'X.', prefix: direction === 'OUTBOUND' ? '9' : '', stripDigits: 0, prepend: '', enabled: true }],
  };
}

/** Transport name used by the trunk, whichever transport option was chosen. */
export function effectiveTransport(s: WizardState): string {
  return s.transport.mode === 'existing' ? s.transport.existingName : s.transport.name;
}

/**
 * Validate one step. Returns field errors (empty object = valid).
 * `routeEgressTrunkPlaceholder` lets outbound routes target the trunk being created.
 */
export function validateStep(step: number, s: WizardState): Record<string, string> {
  switch (step) {
    case 0: {
      const r = validate(pbxInfoSchema, s.info);
      return r.ok ? {} : r.errors;
    }
    case 1: {
      const r = validate(transportSchema, s.transport);
      return r.ok ? {} : r.errors;
    }
    case 2: {
      const r = validate(trunkFormSchema, { ...s.trunk, transportName: effectiveTransport(s) });
      return r.ok ? {} : r.errors;
    }
    case 4: {
      const errors: Record<string, string> = {};
      s.routes.forEach((route, i) => {
        // The wizard fills pbxId at save time; validate with a placeholder UUID.
        const r = validate(routeFormSchema, { ...route, pbxId: route.pbxId || '00000000-0000-4000-8000-000000000000', egressTrunkId: route.egressTrunkId === 'NEW' ? '00000000-0000-4000-8000-000000000000' : route.egressTrunkId });
        if (!r.ok) for (const [k, v] of Object.entries(r.errors)) errors[`routes.${i}.${k}`] = v;
      });
      return errors;
    }
    default:
      return {};
  }
}

export function firstInvalidStep(s: WizardState, upTo: number): number | null {
  for (let i = 0; i <= upTo; i++) if (Object.keys(validateStep(i, s)).length) return i;
  return null;
}
