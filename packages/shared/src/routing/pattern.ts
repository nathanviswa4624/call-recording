/**
 * Asterisk extension-pattern engine.
 *
 * Implements the matching and specificity ordering Asterisk uses for `_`-prefixed
 * patterns so that the API dry-run tester, the CDR classifier and the dialplan
 * compiler all agree with what Asterisk will actually do.
 *
 * Supported syntax: X [0-9], Z [1-9], N [2-9], [..] sets with ranges (e.g. [1-5a]),
 * '.' (one or more of anything), '!' (zero or more of anything), literal 0-9 * # +
 * and letters. The leading '_' is optional on input.
 */

export type PatternToken =
  | { kind: 'set'; chars: ReadonlySet<string>; source: string }
  | { kind: 'oneOrMore' }
  | { kind: 'zeroOrMore' };

export interface CompiledPattern {
  /** Normalised pattern without leading underscore, upper-cased wildcards. */
  readonly normalized: string;
  readonly tokens: readonly PatternToken[];
  /** Minimum number of characters a matching number must have. */
  readonly minLength: number;
  /** Maximum length, or Infinity when the pattern ends with '.' or '!'. */
  readonly maxLength: number;
}

export class PatternSyntaxError extends Error {
  constructor(message: string, readonly pattern: string, readonly position: number) {
    super(`${message} (pattern "${pattern}", position ${position + 1})`);
    this.name = 'PatternSyntaxError';
  }
}

const DIGITS = '0123456789';
const ALLOWED_LITERAL = /^[0-9A-Za-z*#+\-]$/;

function range(chars: string): Set<string> {
  return new Set(chars.split(''));
}

const SET_X = range(DIGITS);
const SET_Z = range('123456789');
const SET_N = range('23456789');

/** Characters permitted in a dialled number we will try to match. */
export const DIALLED_NUMBER_RE = /^[0-9A-Za-z*#+]+$/;

export function compilePattern(input: string): CompiledPattern {
  if (typeof input !== 'string') throw new PatternSyntaxError('Pattern must be a string', String(input), 0);
  let p = input.trim();
  if (p.startsWith('_')) p = p.slice(1);
  if (p.length === 0) throw new PatternSyntaxError('Pattern is empty', input, 0);
  if (p.length > 80) throw new PatternSyntaxError('Pattern is too long (max 80)', input, 80);

  const tokens: PatternToken[] = [];
  let normalized = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '.' || c === '!') {
      if (i !== p.length - 1) {
        throw new PatternSyntaxError(`'${c}' wildcard must be the last character`, input, i);
      }
      tokens.push(c === '.' ? { kind: 'oneOrMore' } : { kind: 'zeroOrMore' });
      normalized += c;
      continue;
    }
    if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) throw new PatternSyntaxError("Unterminated '['", input, i);
      const body = p.slice(i + 1, end);
      if (body.length === 0) throw new PatternSyntaxError('Empty character set', input, i);
      const chars = new Set<string>();
      for (let j = 0; j < body.length; j++) {
        const a = body[j]!;
        if (body[j + 1] === '-' && j + 2 < body.length) {
          const b = body[j + 2]!;
          const from = a.charCodeAt(0);
          const to = b.charCodeAt(0);
          if (to < from) throw new PatternSyntaxError(`Invalid range ${a}-${b}`, input, i + 1 + j);
          for (let k = from; k <= to; k++) chars.add(String.fromCharCode(k));
          j += 2;
        } else {
          if (!ALLOWED_LITERAL.test(a)) throw new PatternSyntaxError(`Invalid character '${a}' in set`, input, i + 1 + j);
          chars.add(a);
        }
      }
      tokens.push({ kind: 'set', chars, source: `[${body}]` });
      normalized += `[${body}]`;
      i = end;
      continue;
    }
    const u = c.toUpperCase();
    if (u === 'X') { tokens.push({ kind: 'set', chars: SET_X, source: 'X' }); normalized += 'X'; continue; }
    if (u === 'Z') { tokens.push({ kind: 'set', chars: SET_Z, source: 'Z' }); normalized += 'Z'; continue; }
    if (u === 'N') { tokens.push({ kind: 'set', chars: SET_N, source: 'N' }); normalized += 'N'; continue; }
    if (!ALLOWED_LITERAL.test(c) || c === '-') {
      throw new PatternSyntaxError(`Invalid character '${c}'`, input, i);
    }
    tokens.push({ kind: 'set', chars: new Set([c]), source: c });
    normalized += c;
  }

  const last = tokens[tokens.length - 1]!;
  const fixed = tokens.filter((t) => t.kind === 'set').length;
  const minLength = last.kind === 'oneOrMore' ? fixed + 1 : fixed;
  const maxLength = last.kind === 'set' ? fixed : Number.POSITIVE_INFINITY;
  return { normalized, tokens, minLength, maxLength };
}

export function isValidPattern(input: string): boolean {
  try {
    compilePattern(input);
    return true;
  } catch {
    return false;
  }
}

export function matchPattern(pattern: CompiledPattern | string, dialled: string): boolean {
  const cp = typeof pattern === 'string' ? compilePattern(pattern) : pattern;
  if (!dialled || !DIALLED_NUMBER_RE.test(dialled)) return false;
  if (dialled.length < cp.minLength || dialled.length > cp.maxLength) return false;
  let i = 0;
  for (const t of cp.tokens) {
    if (t.kind === 'set') {
      const ch = dialled[i];
      if (ch === undefined || !t.chars.has(ch)) return false;
      i++;
    } else {
      // '.' / '!' consume the remainder; length already validated above.
      return true;
    }
  }
  return i === dialled.length;
}

/**
 * Specificity weight of a token, mirroring Asterisk's ext_cmp_pattern ordering:
 * a smaller character class is more specific; '!' and '.' are least specific.
 */
function tokenWeight(t: PatternToken | undefined): [number, number] {
  if (t === undefined) return [0, 0]; // end of pattern sorts before anything
  if (t.kind === 'oneOrMore') return [0x30000, 0];
  if (t.kind === 'zeroOrMore') return [0x40000, 0];
  let min = Number.MAX_SAFE_INTEGER;
  for (const c of t.chars) min = Math.min(min, c.charCodeAt(0));
  return [t.chars.size, min];
}

/**
 * Compare two patterns by Asterisk specificity. Negative when `a` is more
 * specific (would be chosen first by Asterisk within the same context).
 */
export function comparePatternSpecificity(a: CompiledPattern | string, b: CompiledPattern | string): number {
  const ca = typeof a === 'string' ? compilePattern(a) : a;
  const cb = typeof b === 'string' ? compilePattern(b) : b;
  const n = Math.max(ca.tokens.length, cb.tokens.length);
  for (let i = 0; i < n; i++) {
    const [sa, ma] = tokenWeight(ca.tokens[i]);
    const [sb, mb] = tokenWeight(cb.tokens[i]);
    if (sa !== sb) return sa - sb;
    if (ma !== mb) return ma - mb;
  }
  return 0;
}

/**
 * Whether there exists at least one dialled string matched by both patterns.
 * Used to warn about shadowed / overlapping routes.
 */
export function patternsOverlap(a: CompiledPattern | string, b: CompiledPattern | string): boolean {
  const ca = typeof a === 'string' ? compilePattern(a) : a;
  const cb = typeof b === 'string' ? compilePattern(b) : b;
  const lo = Math.max(ca.minLength, cb.minLength);
  const hi = Math.min(ca.maxLength, cb.maxLength);
  if (lo > hi) return false;
  const fixedA = ca.tokens.filter((t) => t.kind === 'set') as Extract<PatternToken, { kind: 'set' }>[];
  const fixedB = cb.tokens.filter((t) => t.kind === 'set') as Extract<PatternToken, { kind: 'set' }>[];
  const common = Math.min(fixedA.length, fixedB.length);
  for (let i = 0; i < common; i++) {
    const sa = fixedA[i]!.chars;
    const sb = fixedB[i]!.chars;
    let any = false;
    for (const c of sa) if (sb.has(c)) { any = true; break; }
    if (!any) return false;
  }
  return true;
}

/** Render a pattern for the Asterisk dialplan (always '_'-prefixed). */
export function toDialplanPattern(input: string): string {
  return `_${compilePattern(input).normalized}`;
}

/** Apply prefix stripping and prepending exactly as the compiled dialplan does. */
export function transformNumber(dialled: string, strip: number, prepend: string): string {
  const s = Math.max(0, Math.min(strip, dialled.length));
  return `${prepend ?? ''}${dialled.slice(s)}`;
}

export interface RouteCandidate<T = unknown> {
  id: string;
  /** Lower value = evaluated first (maps to include order in the dialplan). */
  priority: number;
  /** Full match pattern as dialled (route prefix + pattern). */
  pattern: string;
  enabled?: boolean;
  data?: T;
}

/**
 * Choose the route Asterisk would choose: lowest priority tier first,
 * then most specific pattern within the tier.
 */
export function selectRoute<T>(candidates: readonly RouteCandidate<T>[], dialled: string): RouteCandidate<T> | undefined {
  const compiled = candidates
    .filter((c) => c.enabled !== false)
    .map((c) => ({ c, cp: compilePattern(c.pattern) }))
    .filter(({ cp }) => matchPattern(cp, dialled));
  compiled.sort((x, y) => x.c.priority - y.c.priority || comparePatternSpecificity(x.cp, y.cp));
  return compiled[0]?.c;
}
