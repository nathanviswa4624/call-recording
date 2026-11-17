/**
 * Call classification rule engine (docs/06-call-flow.md §4).
 *
 * Rules are data (stored in `classification_rules`) and evaluated after the call
 * from normalised CDR context, so historical calls can be re-classified at any time.
 */
import { z } from 'zod';
import { compilePattern, matchPattern, type CompiledPattern } from '../routing/pattern.js';

export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL', 'TRANSIT', 'UNKNOWN'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const ANSWER_STATUSES = ['ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CONGESTION', 'ABANDONED'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/** Built-in call type codes seeded on install; organisations may add custom ones. */
export const BUILTIN_CALL_TYPES = [
  'INTERNAL', 'EXTERNAL', 'INBOUND', 'OUTBOUND', 'INTERNATIONAL', 'LOCAL', 'MOBILE', 'NATIONAL',
  'EMERGENCY', 'TRANSFER', 'CONFERENCE', 'QUEUE', 'IVR', 'MISSED', 'ABANDONED', 'FAILED', 'BUSY', 'NO_ANSWER',
] as const;

export const CLASSIFICATION_FIELDS = [
  'direction', 'sourcePbxId', 'destinationPbxId', 'trunkId', 'routeId', 'context',
  'callerNumber', 'destinationNumber', 'callerIsExtension', 'destinationIsExtension',
  'disposition', 'billsec', 'duration', 'sipHeader',
] as const;
export type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number];

export const CONDITION_OPS = ['eq', 'neq', 'in', 'notIn', 'matches', 'regex', 'gt', 'gte', 'lt', 'lte', 'exists', 'notExists'] as const;

export const conditionSchema = z.object({
  field: z.enum(CLASSIFICATION_FIELDS),
  /** Only for field=sipHeader: the header name, e.g. "X-Avaya-Conf-Id". */
  header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(256), z.number(), z.boolean(), z.array(z.string().max(256)).max(500)]).optional(),
}).superRefine((c, ctx) => {
  if (c.field === 'sipHeader' && !c.header) ctx.addIssue({ code: 'custom', message: 'header is required for sipHeader conditions' });
  if (!['exists', 'notExists'].includes(c.op) && c.value === undefined) ctx.addIssue({ code: 'custom', message: `value is required for op ${c.op}` });
  if (c.op === 'matches') {
    try { compilePattern(String(c.value)); } catch (e) { ctx.addIssue({ code: 'custom', message: (e as Error).message }); }
  }
  if (c.op === 'regex') {
    const src = String(c.value);
    if (src.length > 200) ctx.addIssue({ code: 'custom', message: 'regex too long' });
    // reject constructs with catastrophic backtracking potential (nested quantifiers)
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(src)) ctx.addIssue({ code: 'custom', message: 'nested quantifiers are not allowed' });
    try { new RegExp(src); } catch { ctx.addIssue({ code: 'custom', message: 'invalid regular expression' }); }
  }
});
export type Condition = z.infer<typeof conditionSchema>;

export const ruleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  priority: z.number().int().min(0).max(100000),
  enabled: z.boolean().default(true),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).min(1).max(50),
  actions: z.object({
    callTypeCode: z.string().regex(/^[A-Z0-9_]{1,48}$/).optional(),
    routeId: z.string().optional(),
    direction: z.enum(CALL_DIRECTIONS).optional(),
    tags: z.array(z.string().max(48)).max(20).optional(),
  }),
  /** Stop evaluating further rules once this one matched. */
  stop: z.boolean().default(true),
});
export type ClassificationRule = z.infer<typeof ruleSchema>;

export interface ClassificationContext {
  direction: CallDirection;
  sourcePbxId?: string | null;
  destinationPbxId?: string | null;
  trunkId?: string | null;
  routeId?: string | null;
  context?: string | null;
  callerNumber?: string | null;
  destinationNumber?: string | null;
  callerIsExtension?: boolean;
  destinationIsExtension?: boolean;
  /** Asterisk CDR disposition: ANSWERED, NO ANSWER, BUSY, FAILED, CONGESTION */
  disposition?: string | null;
  billsec?: number;
  duration?: number;
  sipHeaders?: Record<string, string>;
  /** True if a queue was exited before answer (from CEL). */
  abandonedInQueue?: boolean;
}

export interface ClassificationResult {
  callTypeCode: string;
  /** 'rule' when a classification rule set the type; 'default' when it came from direction/status. */
  callTypeSource: 'rule' | 'default';
  answerStatus: AnswerStatus;
  direction: CallDirection;
  routeId?: string | null;
  tags: string[];
  matchedRuleIds: string[];
}

export function dispositionToStatus(disposition: string | null | undefined, abandoned = false): AnswerStatus {
  if (abandoned) return 'ABANDONED';
  switch ((disposition ?? '').toUpperCase().replace(/_/g, ' ')) {
    case 'ANSWERED': return 'ANSWERED';
    case 'NO ANSWER': return 'NO_ANSWER';
    case 'BUSY': return 'BUSY';
    case 'CONGESTION': return 'CONGESTION';
    default: return 'FAILED';
  }
}

type Compiled = { rule: ClassificationRule; patterns: Map<number, CompiledPattern>; regexes: Map<number, RegExp> };

function fieldValue(c: Condition, ctx: ClassificationContext): unknown {
  if (c.field === 'sipHeader') {
    const headers = ctx.sipHeaders ?? {};
    const key = Object.keys(headers).find((k) => k.toLowerCase() === c.header!.toLowerCase());
    return key ? headers[key] : undefined;
  }
  return (ctx as unknown as Record<string, unknown>)[c.field];
}

function evalCondition(c: Condition, idx: number, compiled: Compiled, ctx: ClassificationContext): boolean {
  const v = fieldValue(c, ctx);
  const present = v !== undefined && v !== null && v !== '';
  switch (c.op) {
    case 'exists': return present;
    case 'notExists': return !present;
    case 'eq': return present && String(v).toLowerCase() === String(c.value).toLowerCase();
    case 'neq': return !present || String(v).toLowerCase() !== String(c.value).toLowerCase();
    case 'in': return present && Array.isArray(c.value) && c.value.map((x) => x.toLowerCase()).includes(String(v).toLowerCase());
    case 'notIn': return !present || !(Array.isArray(c.value) && c.value.map((x) => x.toLowerCase()).includes(String(v).toLowerCase()));
    case 'matches': return present && matchPattern(compiled.patterns.get(idx)!, String(v));
    case 'regex': return present && compiled.regexes.get(idx)!.test(String(v).slice(0, 512));
    case 'gt': return present && Number(v) > Number(c.value);
    case 'gte': return present && Number(v) >= Number(c.value);
    case 'lt': return present && Number(v) < Number(c.value);
    case 'lte': return present && Number(v) <= Number(c.value);
  }
}

export class ClassificationEngine {
  private readonly compiled: Compiled[];

  constructor(rules: readonly ClassificationRule[]) {
    this.compiled = rules
      .filter((r) => r.enabled !== false)
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((rule) => {
        const patterns = new Map<number, CompiledPattern>();
        const regexes = new Map<number, RegExp>();
        rule.conditions.forEach((c, i) => {
          if (c.op === 'matches') patterns.set(i, compilePattern(String(c.value)));
          if (c.op === 'regex') regexes.set(i, new RegExp(String(c.value)));
        });
        return { rule, patterns, regexes };
      });
  }

  classify(ctx: ClassificationContext): ClassificationResult {
    const answerStatus = dispositionToStatus(ctx.disposition, ctx.abandonedInQueue);
    let callTypeCode: string | undefined;
    let direction = ctx.direction;
    let routeId = ctx.routeId ?? null;
    const tags = new Set<string>();
    const matchedRuleIds: string[] = [];

    for (const compiled of this.compiled) {
      const { rule } = compiled;
      const evalCtx = { ...ctx, direction };
      const results = rule.conditions.map((c, i) => evalCondition(c, i, compiled, evalCtx));
      const ok = rule.match === 'all' ? results.every(Boolean) : results.some(Boolean);
      if (!ok) continue;
      matchedRuleIds.push(rule.id);
      if (rule.actions.callTypeCode && !callTypeCode) callTypeCode = rule.actions.callTypeCode;
      if (rule.actions.direction) direction = rule.actions.direction;
      if (rule.actions.routeId) routeId = rule.actions.routeId;
      rule.actions.tags?.forEach((t) => tags.add(t));
      if (rule.stop) break;
    }

    const callTypeSource = callTypeCode ? 'rule' : 'default';
    if (!callTypeCode) callTypeCode = defaultCallType(direction, answerStatus);
    return { callTypeCode, callTypeSource, answerStatus, direction, routeId, tags: [...tags], matchedRuleIds };
  }
}

/** Fallback when no rule assigns a type: unanswered status wins, then direction. */
export function defaultCallType(direction: CallDirection, status: AnswerStatus): string {
  if (status === 'ABANDONED') return 'ABANDONED';
  if (status === 'NO_ANSWER') return direction === 'INBOUND' ? 'MISSED' : 'NO_ANSWER';
  if (status === 'BUSY') return 'BUSY';
  if (status === 'FAILED' || status === 'CONGESTION') return 'FAILED';
  switch (direction) {
    case 'INBOUND': return 'INBOUND';
    case 'OUTBOUND': return 'OUTBOUND';
    case 'INTERNAL': return 'INTERNAL';
    default: return 'EXTERNAL';
  }
}
