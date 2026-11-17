import { describe, expect, it } from 'vitest';
import {
  compilePattern, comparePatternSpecificity, matchPattern, patternsOverlap, PatternSyntaxError,
  selectRoute, toDialplanPattern, transformNumber,
} from '../src/routing/pattern.js';

describe('compilePattern', () => {
  it('accepts with or without underscore and normalises wildcards', () => {
    expect(compilePattern('_9xxxxxxxxxx').normalized).toBe('9XXXXXXXXXX');
    expect(compilePattern('9XXXXXXXXXX').normalized).toBe('9XXXXXXXXXX');
    expect(toDialplanPattern('7XXX')).toBe('_7XXX');
  });
  it('computes length bounds', () => {
    expect(compilePattern('9XXXXXXXXXX')).toMatchObject({ minLength: 11, maxLength: 11 });
    expect(compilePattern('00X.')).toMatchObject({ minLength: 4, maxLength: Infinity });
    expect(compilePattern('00X!')).toMatchObject({ minLength: 3, maxLength: Infinity });
  });
  it('rejects bad syntax', () => {
    expect(() => compilePattern('9X.X')).toThrow(PatternSyntaxError);
    expect(() => compilePattern('9[12')).toThrow(/Unterminated/);
    expect(() => compilePattern('9[]')).toThrow(/Empty/);
    expect(() => compilePattern('9;X')).toThrow(/Invalid character/);
    expect(() => compilePattern('')).toThrow(/empty/);
  });
});

describe('matchPattern', () => {
  it('matches spec examples', () => {
    expect(matchPattern('9XXXXXXXXXX', '90501234567')).toBe(true);
    expect(matchPattern('9XXXXXXXXXX', '9050123456')).toBe(false);
    expect(matchPattern('00XXXXXXXXXXXX', '00971501234567')).toBe(true);
    expect(matchPattern('7XXX', '7001')).toBe(true);
    expect(matchPattern('7XXX', '8001')).toBe(false);
  });
  it('handles N, Z and sets', () => {
    expect(matchPattern('NXX', '200')).toBe(true);
    expect(matchPattern('NXX', '100')).toBe(false);
    expect(matchPattern('ZXX', '100')).toBe(true);
    expect(matchPattern('ZXX', '000')).toBe(false);
    expect(matchPattern('[1-3]XX', '399')).toBe(true);
    expect(matchPattern('[1-3]XX', '499')).toBe(false);
    expect(matchPattern('[15-7]X', '62')).toBe(true);
  });
  it('handles . and !', () => {
    expect(matchPattern('9.', '9')).toBe(false);
    expect(matchPattern('9.', '91')).toBe(true);
    expect(matchPattern('9!', '9')).toBe(true);
  });
  it('rejects garbage input', () => {
    expect(matchPattern('X.', '12;3')).toBe(false);
    expect(matchPattern('X.', '')).toBe(false);
  });
});

describe('specificity / route selection', () => {
  it('orders like Asterisk (smaller set first)', () => {
    expect(comparePatternSpecificity('95XXXXXXXX', '9XXXXXXXXX')).toBeLessThan(0);
    expect(comparePatternSpecificity('NXXX', 'XXXX')).toBeLessThan(0);
    expect(comparePatternSpecificity('9XXX', '9X.')).toBeLessThan(0);
  });
  it('selects by priority tier then specificity', () => {
    const routes = [
      { id: 'local', priority: 10, pattern: '9XXXXXXXXX' },
      { id: 'mobile', priority: 10, pattern: '95XXXXXXXX' },
      { id: 'intl', priority: 10, pattern: '900XXXXXXXXX' },
      { id: 'internal', priority: 10, pattern: '2XXX' },
    ];
    expect(selectRoute(routes, '9512345678')?.id).toBe('mobile');
    expect(selectRoute(routes, '9412345678')?.id).toBe('local');
    expect(selectRoute(routes, '900123456789')?.id).toBe('intl');
    expect(selectRoute(routes, '2001')?.id).toBe('internal');
    expect(selectRoute(routes, '5555')).toBeUndefined();
    // lower priority tier wins even if less specific
    expect(selectRoute([...routes, { id: 'catch', priority: 1, pattern: '9.' }], '9512345678')?.id).toBe('catch');
    // disabled routes are skipped
    expect(selectRoute([{ id: 'x', priority: 1, pattern: '9.', enabled: false }, ...routes], '9512345678')?.id).toBe('mobile');
  });
  it('detects overlaps', () => {
    expect(patternsOverlap('9XXXXXXXXX', '95XXXXXXXX')).toBe(true);
    expect(patternsOverlap('2XXX', '7XXX')).toBe(false);
    expect(patternsOverlap('2XXX', '2XXXX')).toBe(false);
    expect(patternsOverlap('2X.', '2XXXX')).toBe(true);
  });
});

describe('transformNumber', () => {
  it('strips and prepends', () => {
    expect(transformNumber('90501234567', 1, '')).toBe('0501234567');
    expect(transformNumber('0501234567', 1, '+971')).toBe('+971501234567');
    expect(transformNumber('12', 5, '')).toBe('');
  });
});
