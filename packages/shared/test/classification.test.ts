import { describe, expect, it } from 'vitest';
import { ClassificationEngine, defaultCallType, ruleSchema, type ClassificationRule } from '../src/classification/engine.js';

const AVAYA = 'pbx-avaya';

const rules: ClassificationRule[] = [
  ruleSchema.parse({
    id: 'r-mobile', name: 'Avaya mobile', priority: 10,
    conditions: [
      { field: 'sourcePbxId', op: 'eq', value: AVAYA },
      { field: 'destinationNumber', op: 'matches', value: '9XXXXXXXXXX' },
    ],
    actions: { callTypeCode: 'OUTBOUND_MOBILE', routeId: 'route-mobile', direction: 'OUTBOUND' },
  }),
  ruleSchema.parse({
    id: 'r-inbound', name: 'External to extension', priority: 20,
    conditions: [
      { field: 'callerIsExtension', op: 'eq', value: false },
      { field: 'destinationIsExtension', op: 'eq', value: true },
    ],
    actions: { callTypeCode: 'INBOUND_EXTERNAL', direction: 'INBOUND' },
  }),
  ruleSchema.parse({
    id: 'r-internal', name: '201 to 202', priority: 30,
    conditions: [
      { field: 'callerNumber', op: 'eq', value: '201' },
      { field: 'destinationNumber', op: 'eq', value: '202' },
    ],
    actions: { callTypeCode: 'INTERNAL', direction: 'INTERNAL' },
  }),
  ruleSchema.parse({
    id: 'r-conf', name: 'Avaya conference header', priority: 5, stop: false,
    conditions: [{ field: 'sipHeader', header: 'X-Conf-Id', op: 'exists' }],
    actions: { tags: ['conference'] },
  }),
];

describe('ClassificationEngine', () => {
  const engine = new ClassificationEngine(rules);

  it('classifies the spec §61 example as outbound mobile', () => {
    const r = engine.classify({
      direction: 'UNKNOWN', sourcePbxId: AVAYA, callerNumber: '201', destinationNumber: '90501234567',
      disposition: 'ANSWERED', billsec: 272,
    });
    expect(r).toMatchObject({ callTypeCode: 'OUTBOUND_MOBILE', callTypeSource: 'rule', routeId: 'route-mobile', direction: 'OUTBOUND', answerStatus: 'ANSWERED' });
  });

  it('classifies inbound external and internal', () => {
    expect(engine.classify({ direction: 'UNKNOWN', callerNumber: '971501234567', destinationNumber: '201', callerIsExtension: false, destinationIsExtension: true, disposition: 'ANSWERED' }).callTypeCode).toBe('INBOUND_EXTERNAL');
    expect(engine.classify({ direction: 'UNKNOWN', callerNumber: '201', destinationNumber: '202', callerIsExtension: true, destinationIsExtension: true, disposition: 'ANSWERED' }).callTypeCode).toBe('INTERNAL');
  });

  it('non-stopping rules add tags and continue', () => {
    const r = engine.classify({ direction: 'UNKNOWN', sourcePbxId: AVAYA, destinationNumber: '90501234567', sipHeaders: { 'x-conf-id': 'abc' }, disposition: 'ANSWERED' });
    expect(r.tags).toEqual(['conference']);
    expect(r.matchedRuleIds).toEqual(['r-conf', 'r-mobile']);
  });

  it('falls back to status/direction types', () => {
    expect(engine.classify({ direction: 'INBOUND', callerNumber: 'x', disposition: 'NO ANSWER' })).toMatchObject({ callTypeCode: 'MISSED', callTypeSource: 'default' });
    expect(defaultCallType('OUTBOUND', 'BUSY')).toBe('BUSY');
    expect(defaultCallType('OUTBOUND', 'FAILED')).toBe('FAILED');
    expect(defaultCallType('INBOUND', 'ANSWERED')).toBe('INBOUND');
    expect(engine.classify({ direction: 'INBOUND', disposition: 'ANSWERED', abandonedInQueue: true }).callTypeCode).toBe('ABANDONED');
  });

  it('rejects unsafe regex and bad patterns in rules', () => {
    expect(() => ruleSchema.parse({ id: 'x', name: 'x', priority: 1, conditions: [{ field: 'callerNumber', op: 'regex', value: '(a+)+$' }], actions: {} })).toThrow();
    expect(() => ruleSchema.parse({ id: 'x', name: 'x', priority: 1, conditions: [{ field: 'callerNumber', op: 'matches', value: '9X.X' }], actions: {} })).toThrow();
  });
});
