/**
 * Issue Query parser -- reads the text a Member types into an IssueQuery
 * (design Issues, Search), or refuses it with a named reason.
 *
 * Grammar: terms separated by whitespace. A term is `key:value`, optionally
 * negated with a leading `!`, or free text (a bare word or a double-quoted
 * phrase). A value is bare, double-quoted (`\"` and `\\` escape), or a list
 * `[a, "b c"]`. `*` in a value is a wildcard. Known keys:
 *
 *   is:<status, substatus or standing>   has:<key>
 *   timesSeen, users, reports            count, optionally `>N`, `>=N`, `<N`, `<=N`
 *   age, lastSeen                        `-D`, `+D`, `>D`, ... with D = N m|h|d|w,
 *                                        or a comparison with an ISO date
 *   assigned                             me, none, an email, or #team
 *   release (latest), priority, level, environment
 *   tags[key]                            a tag; any other key is also a tag
 */

import { isRefusal, refusal, type Refusal } from '../refusal.js';
import {
  COUNT_KEYS,
  FIELD_KEYS,
  IS_VALUES,
  TIME_KEYS,
  type Comparator,
  type CountKey,
  type DurationUnit,
  type FieldKey,
  type IssueQuery,
  type IsValue,
  type QueryTerm,
  type TimeBound,
  type TimeKey,
} from './query.js';

/** A value as written: one value (quoted or not) or a list. */
type RawValue =
  | { readonly kind: 'single'; readonly text: string; readonly quoted: boolean }
  | { readonly kind: 'list'; readonly items: readonly string[] };

const KEYED = /^(!?)(tags\[[^[\]\s"]+\]|[A-Za-z_][A-Za-z0-9_.-]*):(.*)$/s;
const TAG_SPELLING = /^tags\[(.+)\]$/s;
const HAS_KEY = /^[A-Za-z0-9_.:@/-]+$/;
const COUNT = /^(>=|<=|>|<)?(\d+)$/;
const ELAPSED = /^(\+|-|>=|<=|>|<)(\d+)([mhdw])$/;
const DATE = /^(>=|<=|>|<)(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z)?)$/;
const PRIORITIES: readonly string[] = ['low', 'medium', 'high'];
const LEVELS: readonly string[] = ['fatal', 'error', 'warning', 'info', 'debug'];
const ELAPSED_SIGN: Readonly<Record<string, Comparator>> = { '-': '<=', '+': '>=' };

const MALFORMED = 'search_malformed';
const EMPTY = 'search_empty_value';
const BAD_VALUE = 'search_bad_value';

// --- predicates ---

function isIsValue(value: string): value is IsValue {
  return (IS_VALUES as readonly string[]).includes(value);
}

function isCountKey(key: string): key is CountKey {
  return (COUNT_KEYS as readonly string[]).includes(key);
}

function isTimeKey(key: string): key is TimeKey {
  return (TIME_KEYS as readonly string[]).includes(key);
}

function isFieldKey(key: string): key is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(key);
}

function isComparator(op: string): op is Comparator {
  return op === '>' || op === '>=' || op === '<' || op === '<=';
}

function isDurationUnit(unit: string): unit is DurationUnit {
  return unit === 'm' || unit === 'h' || unit === 'd' || unit === 'w';
}

function isAssignee(value: string): boolean {
  return value === 'me' || value === 'none' || /^#[^\s#]+$/.test(value) || /^[^\s@]+@[^\s@]+$/.test(value);
}

function isFieldValue({ key, value }: { key: FieldKey; value: string }): boolean {
  if (key === 'priority') return PRIORITIES.includes(value);
  if (key === 'level') return LEVELS.includes(value);
  if (key === 'assigned') return isAssignee(value);
  return true;
}

function hasSyntaxChars(text: string): boolean {
  return /["[\]]/.test(text);
}

// --- tokens ---

/** The index of the quote closing the one at `start`, or -1. */
function quoteEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i;
  }
  return -1;
}

/** The index of the bracket closing the one at `start`, skipping quoted parts, or -1. */
function bracketEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === ']') return i;
    if (text[i] === '[') return -1;
    if (text[i] === '"') {
      i = quoteEnd(text, i);
      if (i < 0) return -1;
    }
  }
  return -1;
}

/** Splits on whitespace outside quotes and brackets; quotes and brackets stay in the tokens. */
function tokenize(text: string): readonly string[] | Refusal {
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    const end = ch === '"' ? quoteEnd(text, i) : ch === '[' ? bracketEnd(text, i) : i;
    if (end < 0) return refusal(MALFORMED);
    current += text.slice(i, end + 1);
    i = end;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/** The text of a quoted part that spans the whole of `raw`, unescaped, or null. */
function unquote(raw: string): string | null {
  if (!raw.startsWith('"') || quoteEnd(raw, 0) !== raw.length - 1) return null;
  return raw.slice(1, -1).replace(/\\(.)/gs, '$1');
}

/** Splits a list body on commas outside quotes. */
function listItems(body: string): readonly string[] {
  const items: string[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '"') i = quoteEnd(body, i);
    else if (body[i] === ',') {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim());
}

function readItem(raw: string): string | Refusal {
  if (raw === '') return refusal(EMPTY);
  if (raw.startsWith('"')) {
    const text = unquote(raw);
    if (text === null) return refusal(MALFORMED);
    return text === '' ? refusal(EMPTY) : text;
  }
  return hasSyntaxChars(raw) ? refusal(MALFORMED) : raw;
}

function readValue(raw: string): RawValue | Refusal {
  if (!raw.startsWith('[')) {
    const text = readItem(raw);
    return typeof text === 'string' ? { kind: 'single', text, quoted: raw.startsWith('"') } : text;
  }
  if (bracketEnd(raw, 0) !== raw.length - 1) return refusal(MALFORMED);
  const body = raw.slice(1, -1);
  if (body.trim() === '') return refusal(EMPTY);
  const items: string[] = [];
  for (const item of listItems(body)) {
    const text = readItem(item);
    if (typeof text !== 'string') return text;
    items.push(text);
  }
  return { kind: 'list', items };
}

// --- terms ---

function valuesOf(value: RawValue): readonly string[] {
  return value.kind === 'list' ? value.items : [value.text];
}

/** The text of a single unquoted value, or null when the value is quoted or a list. */
function plainText(value: RawValue): string | null {
  return value.kind === 'single' && !value.quoted ? value.text : null;
}

function readCount({ key, value, negated }: { key: CountKey; value: RawValue; negated: boolean }): QueryTerm | Refusal {
  const match = COUNT.exec(plainText(value) ?? '');
  const number = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(number)) return refusal(BAD_VALUE);
  return { kind: 'count', negated, key, op: (match[1] as Comparator | undefined) ?? '=', value: number };
}

function readBound(text: string): TimeBound | null {
  const elapsed = ELAPSED.exec(text);
  if (elapsed) {
    const [, sign = '', amountText = '', unit = ''] = elapsed;
    const op = ELAPSED_SIGN[sign] ?? sign;
    const amount = Number(amountText);
    if (!isComparator(op) || !isDurationUnit(unit) || !Number.isSafeInteger(amount)) return null;
    return { kind: 'elapsed', op, duration: { amount, unit } };
  }
  const date = DATE.exec(text);
  const [, op = '', iso = ''] = date ?? [];
  const at = Date.parse(iso);
  if (!date || !isComparator(op) || Number.isNaN(at) || !isCalendarDate(iso, at)) return null;
  return { kind: 'date', op, at };
}

/** Whether `at` is the day `iso` names; Date.parse rolls some impossible days over. */
function isCalendarDate(iso: string, at: number): boolean {
  return new Date(at).toISOString().slice(0, 10) === iso.slice(0, 10);
}

function readTime({ key, value, negated }: { key: TimeKey; value: RawValue; negated: boolean }): QueryTerm | Refusal {
  const bound = readBound(plainText(value) ?? '');
  return bound ? { kind: 'time', negated, key, bound } : refusal(BAD_VALUE);
}

function readField({ key, value, negated }: { key: FieldKey; value: RawValue; negated: boolean }): QueryTerm | Refusal {
  const values = valuesOf(value);
  if (!values.every((v) => isFieldValue({ key, value: v }))) return refusal(BAD_VALUE);
  return { kind: 'field', negated, key, values };
}

function readIs({ value, negated }: { value: RawValue; negated: boolean }): QueryTerm | Refusal {
  if (value.kind === 'list') return refusal(BAD_VALUE);
  return isIsValue(value.text) ? { kind: 'is', negated, value: value.text } : refusal('search_unknown_status');
}

function readHas({ value, negated }: { value: RawValue; negated: boolean }): QueryTerm | Refusal {
  if (value.kind === 'list' || !HAS_KEY.test(value.text)) return refusal(BAD_VALUE);
  return { kind: 'has', negated, key: value.text };
}

function readKeyed({ key, value, negated }: { key: string; value: RawValue; negated: boolean }): QueryTerm | Refusal {
  if (key === 'is') return readIs({ value, negated });
  if (key === 'has') return readHas({ value, negated });
  if (isCountKey(key)) return readCount({ key, value, negated });
  if (isTimeKey(key)) return readTime({ key, value, negated });
  if (isFieldKey(key)) return readField({ key, value, negated });
  const tag = TAG_SPELLING.exec(key)?.[1] ?? key;
  return { kind: 'tag', negated, key: tag, values: valuesOf(value) };
}

function readText(token: string): QueryTerm | Refusal {
  if (token.startsWith('!')) return refusal('search_negated_text');
  const text = readItem(token);
  return typeof text === 'string' ? { kind: 'text', text } : text;
}

function readTerm(token: string): QueryTerm | Refusal {
  const keyed = token.startsWith('"') ? null : KEYED.exec(token);
  if (!keyed) return readText(token);
  const [, not = '', key = '', rawValue = ''] = keyed;
  const value = readValue(rawValue);
  if (isRefusal(value)) return value;
  return readKeyed({ key, value, negated: not === '!' });
}

// --- exports ---

/** Parses the text of an Issue Query, or refuses it with the first problem found. */
export function parseIssueQuery(text: string): IssueQuery | Refusal {
  const tokens = tokenize(text);
  if (isRefusal(tokens)) return tokens;
  const terms: QueryTerm[] = [];
  for (const token of tokens) {
    const term = readTerm(token);
    if (isRefusal(term)) return term;
    terms.push(term);
  }
  return { terms };
}
