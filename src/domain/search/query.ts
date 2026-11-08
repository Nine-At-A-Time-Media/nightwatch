/**
 * Issue Query -- the parsed form of a search over Issues (design Issues,
 * Search; architecture use-case surface, searchIssues), and its printer.
 *
 * A query is a list of terms, all of which must hold. The printed form is
 * canonical: `parseIssueQuery(printIssueQuery(q))` is `q` for every query
 * the parser can produce. Canonical choices: a one-value list prints as a
 * bare value, a tag always prints as `tags[key]`, an elapsed bound of `<=`
 * prints as `-D` and of `>=` as `+D`, a date prints in full ISO form, and a
 * value is quoted whenever printing it bare could read back differently.
 *
 * Time bounds compare two different quantities. An elapsed bound compares
 * the time since the moment (`age:-24h` -- first seen within the last 24
 * hours); a date bound compares the moment itself (`lastSeen:>2026-01-01` --
 * last seen after that date).
 */

export type Comparator = '>' | '>=' | '<' | '<=';
export type Comparison = '=' | Comparator;

export type DurationUnit = 'm' | 'h' | 'd' | 'w';
export type Duration = { readonly amount: number; readonly unit: DurationUnit };

export type TimeBound =
  | { readonly kind: 'elapsed'; readonly op: Comparator; readonly duration: Duration }
  /** `at` is epoch milliseconds. */
  | { readonly kind: 'date'; readonly op: Comparator; readonly at: number };

export const IS_VALUES = [
  'unresolved',
  'resolved',
  'archived',
  'new',
  'ongoing',
  'escalating',
  'regressed',
  'for_review',
  'assigned',
  'unassigned',
  'linked',
  'unlinked',
] as const;
export type IsValue = (typeof IS_VALUES)[number];

export const COUNT_KEYS = ['timesSeen', 'users', 'reports'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export const TIME_KEYS = ['age', 'lastSeen'] as const;
export type TimeKey = (typeof TIME_KEYS)[number];

export const FIELD_KEYS = ['assigned', 'release', 'priority', 'level', 'environment'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** One term of an Issue Query. A list of values matches when any one does. */
export type QueryTerm =
  /** Free text, matched against title, culprit and Short Id. */
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'is'; readonly negated: boolean; readonly value: IsValue }
  | { readonly kind: 'has'; readonly negated: boolean; readonly key: string }
  | { readonly kind: 'count'; readonly negated: boolean; readonly key: CountKey; readonly op: Comparison; readonly value: number }
  | { readonly kind: 'time'; readonly negated: boolean; readonly key: TimeKey; readonly bound: TimeBound }
  | { readonly kind: 'field'; readonly negated: boolean; readonly key: FieldKey; readonly values: readonly string[] }
  | { readonly kind: 'tag'; readonly negated: boolean; readonly key: string; readonly values: readonly string[] };

export type IssueQuery = { readonly terms: readonly QueryTerm[] };

/** A bare value: no whitespace, quote, backslash, bracket or comma. */
const BARE = /^[^\s"\\[\],]+$/;
/** First characters a bare value may not start with, since they read as syntax. */
const SYNTAX_START = /^[!<>+\-"]/;

// --- predicates ---

function isBareValue(value: string): boolean {
  return BARE.test(value) && !SYNTAX_START.test(value);
}

function isBareText(text: string): boolean {
  return isBareValue(text) && !text.includes(':');
}

// --- helpers ---

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function printValue(value: string): string {
  return isBareValue(value) ? value : quoted(value);
}

function printValues(values: readonly string[]): string {
  const [only] = values;
  return values.length === 1 && only !== undefined ? printValue(only) : `[${values.map(printValue).join(', ')}]`;
}

function printBound(bound: TimeBound): string {
  if (bound.kind === 'date') return `${bound.op}${new Date(bound.at).toISOString()}`;
  const amount = `${bound.duration.amount}${bound.duration.unit}`;
  if (bound.op === '<=') return `-${amount}`;
  if (bound.op === '>=') return `+${amount}`;
  return `${bound.op}${amount}`;
}

function printTerm(term: QueryTerm): string {
  if (term.kind === 'text') return isBareText(term.text) ? term.text : quoted(term.text);
  const not = term.negated ? '!' : '';
  switch (term.kind) {
    case 'is':
      return `${not}is:${term.value}`;
    case 'has':
      return `${not}has:${term.key}`;
    case 'count':
      return `${not}${term.key}:${term.op === '=' ? '' : term.op}${term.value}`;
    case 'time':
      return `${not}${term.key}:${printBound(term.bound)}`;
    case 'field':
      return `${not}${term.key}:${printValues(term.values)}`;
    case 'tag':
      return `${not}tags[${term.key}]:${printValues(term.values)}`;
  }
}

// --- exports ---

/** The canonical text of an Issue Query. */
export function printIssueQuery(query: IssueQuery): string {
  return query.terms.map(printTerm).join(' ');
}
