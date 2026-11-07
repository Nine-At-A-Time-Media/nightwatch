import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseIssueQuery } from '../../../../src/domain/search/parse.js';
import { printIssueQuery, type IssueQuery, type QueryTerm } from '../../../../src/domain/search/query.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

function parsed(text: string): IssueQuery {
  const query = parseIssueQuery(text);
  if (isRefusal(query)) throw new Error(query.refusal);
  return query;
}

function terms(text: string): readonly QueryTerm[] {
  return parsed(text).terms;
}

// --- generators: queries in the canonical form the parser produces ---

const anyText = fc.string({
  minLength: 1,
  maxLength: 12,
  unit: fc.constantFrom('a', 'Z', '7', ' ', '"', '\\', '*', ',', '[', ']', ':', '!', '-', '>', '#', 'e', 'é'),
});
const tagKey = fc.stringMatching(/^[A-Za-z0-9_.@/-][A-Za-z0-9_.:@/-]{0,8}$/);
const comparator = fc.constantFrom('>' as const, '>=' as const, '<' as const, '<=' as const);
const duration = fc.record({
  amount: fc.nat({ max: 10_000 }),
  unit: fc.constantFrom('m' as const, 'h' as const, 'd' as const, 'w' as const),
});
const negated = fc.boolean();

const term: fc.Arbitrary<QueryTerm> = fc.oneof(
  fc.record({ kind: fc.constant('text' as const), text: anyText }),
  fc.record({
    kind: fc.constant('is' as const),
    negated,
    value: fc.constantFrom(
      'unresolved' as const,
      'resolved' as const,
      'archived' as const,
      'new' as const,
      'ongoing' as const,
      'escalating' as const,
      'regressed' as const,
      'for_review' as const,
      'assigned' as const,
      'unassigned' as const,
      'linked' as const,
      'unlinked' as const,
    ),
  }),
  fc.record({ kind: fc.constant('has' as const), negated, key: tagKey }),
  fc.record({
    kind: fc.constant('count' as const),
    negated,
    key: fc.constantFrom('timesSeen' as const, 'users' as const, 'reports' as const),
    op: fc.constantFrom('=' as const, '>' as const, '>=' as const, '<' as const, '<=' as const),
    value: fc.nat(),
  }),
  fc.record({
    kind: fc.constant('time' as const),
    negated,
    key: fc.constantFrom('age' as const, 'lastSeen' as const),
    bound: fc.oneof(
      fc.record({ kind: fc.constant('elapsed' as const), op: comparator, duration }),
      fc.record({ kind: fc.constant('date' as const), op: comparator, at: fc.integer({ min: 0, max: 253_402_300_799_999 }) }),
    ),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    negated,
    key: fc.constant('release' as const),
    values: fc.array(anyText, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    negated,
    key: fc.constant('environment' as const),
    values: fc.array(anyText, { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    negated,
    key: fc.constant('priority' as const),
    values: fc.array(fc.constantFrom('low', 'medium', 'high'), { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    negated,
    key: fc.constant('level' as const),
    values: fc.array(fc.constantFrom('fatal', 'error', 'warning', 'info', 'debug'), { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    negated,
    key: fc.constant('assigned' as const),
    values: fc.array(fc.constantFrom('me', 'none', 'ana@example.com', '#web'), { minLength: 1, maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('tag' as const),
    negated,
    key: fc.oneof(tagKey, fc.constantFrom('level', 'is', 'has', 'release')),
    values: fc.array(anyText, { minLength: 1, maxLength: 3 }),
  }),
);

const query: fc.Arbitrary<IssueQuery> = fc.record({ terms: fc.array(term, { maxLength: 6 }) });

describe('parseIssueQuery', () => {
  it('reads status, assignee and release terms', () => {
    expect(terms('is:unresolved assigned:me release:latest')).toEqual([
      { kind: 'is', negated: false, value: 'unresolved' },
      { kind: 'field', negated: false, key: 'assigned', values: ['me'] },
      { kind: 'field', negated: false, key: 'release', values: ['latest'] },
    ]);
  });

  it('reads negation, lists with spaces, and quoted values', () => {
    expect(terms('!environment:[production, "staging eu"] !is:resolved')).toEqual([
      { kind: 'field', negated: true, key: 'environment', values: ['production', 'staging eu'] },
      { kind: 'is', negated: true, value: 'resolved' },
    ]);
  });

  it('reads comparisons on counts, durations and dates', () => {
    expect(terms('reports:>0 timesSeen:10 users:<=5 age:-24h lastSeen:+7d age:>2w lastSeen:>=2026-01-02')).toEqual([
      { kind: 'count', negated: false, key: 'reports', op: '>', value: 0 },
      { kind: 'count', negated: false, key: 'timesSeen', op: '=', value: 10 },
      { kind: 'count', negated: false, key: 'users', op: '<=', value: 5 },
      { kind: 'time', negated: false, key: 'age', bound: { kind: 'elapsed', op: '<=', duration: { amount: 24, unit: 'h' } } },
      { kind: 'time', negated: false, key: 'lastSeen', bound: { kind: 'elapsed', op: '>=', duration: { amount: 7, unit: 'd' } } },
      { kind: 'time', negated: false, key: 'age', bound: { kind: 'elapsed', op: '>', duration: { amount: 2, unit: 'w' } } },
      { kind: 'time', negated: false, key: 'lastSeen', bound: { kind: 'date', op: '>=', at: Date.UTC(2026, 0, 2) } },
    ]);
  });

  it('reads tags in both spellings, has:, unknown keys as tags, and free text', () => {
    expect(terms('tags[os.name]:Linux browser:Fire* has:url WEB-3K "connection reset" timeout')).toEqual([
      { kind: 'tag', negated: false, key: 'os.name', values: ['Linux'] },
      { kind: 'tag', negated: false, key: 'browser', values: ['Fire*'] },
      { kind: 'has', negated: false, key: 'url' },
      { kind: 'text', text: 'WEB-3K' },
      { kind: 'text', text: 'connection reset' },
      { kind: 'text', text: 'timeout' },
    ]);
  });

  it('reads priority, level and every assignee spelling', () => {
    expect(terms('priority:high level:[error, fatal] assigned:[none, ana@example.com, #web]')).toEqual([
      { kind: 'field', negated: false, key: 'priority', values: ['high'] },
      { kind: 'field', negated: false, key: 'level', values: ['error', 'fatal'] },
      { kind: 'field', negated: false, key: 'assigned', values: ['none', 'ana@example.com', '#web'] },
    ]);
  });

  it('reads an empty query as no terms', () => {
    expect(terms('   ')).toEqual([]);
  });

  it.each([
    ['message:"unterminated', 'search_malformed'],
    ['release:[a, b', 'search_malformed'],
    ['release:', 'search_empty_value'],
    ['release:[]', 'search_empty_value'],
    ['""', 'search_empty_value'],
    ['!timeout', 'search_negated_text'],
    ['is:sleeping', 'search_unknown_status'],
    ['is:[new, ongoing]', 'search_bad_value'],
    ['priority:urgent', 'search_bad_value'],
    ['level:critical', 'search_bad_value'],
    ['assigned:bob', 'search_bad_value'],
    ['timesSeen:many', 'search_bad_value'],
    ['users:>1.5', 'search_bad_value'],
    ['age:24h', 'search_bad_value'],
    ['lastSeen:>2026-13-45', 'search_bad_value'],
    ['lastSeen:2026-01-01', 'search_bad_value'],
    ['ab"cd"', 'search_malformed'],
    ['"a"b', 'search_malformed'],
  ])('refuses %s', (text, reason) => {
    expect(parseIssueQuery(text)).toEqual({ refusal: reason });
  });

  it('parses what it prints: parse(print(query)) is the query', () => {
    fc.assert(
      fc.property(query, (q) => {
        expect(parseIssueQuery(printIssueQuery(q))).toEqual(q);
      }),
    );
  });
});
