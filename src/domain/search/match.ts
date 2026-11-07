/**
 * Issue Query evaluation -- whether one Issue matches an Issue Query (design
 * Issues, Search). A pure predicate over IssueFacts, the values a Project's
 * store supplies per Issue, and a SearchContext, the values the searching
 * request supplies. Every term must hold; a list matches when any value does.
 *
 * Matching rules:
 * - Free text matches the title, culprit or Short Id anywhere, ignoring case.
 * - Values match whole, with case; `*` matches any run of characters.
 * - Emails compare ignoring case.
 * - An Issue being deleted or merged matches nothing.
 */

import type { Level } from '../issue/priority.js';
import type { ShortId } from '../issue/short-id.js';
import type { IssueState } from '../issue/state.js';
import type { Release } from '../release/ordering.js';
import type { Comparison, CountKey, Duration, DurationUnit, FieldKey, IsValue, IssueQuery, QueryTerm, TimeBound } from './query.js';

/** The Assignee as search sees it: a Member by email, or a Team by slug. */
export type AssigneeFacts = { readonly memberEmail: string } | { readonly team: string };

/** What a Project's store supplies about one Issue for search. */
export type IssueFacts = {
  /** Status, Substatus, counts, Priority, first and last seen, For Review. */
  readonly state: IssueState;
  readonly shortId: ShortId;
  readonly title: string;
  readonly culprit: string;
  readonly level: Level;
  readonly assignee: AssigneeFacts | null;
  /** Releases the Issue was seen in. */
  readonly releases: readonly Release[];
  readonly environments: readonly string[];
  /** Tag values seen per tag key. */
  readonly tags: ReadonlyMap<string, readonly string[]>;
  readonly reportCount: number;
  /** Whether the Issue has an External Link. */
  readonly linked: boolean;
};

/** What the searching request supplies. */
export type SearchContext = {
  readonly viewerEmail: string;
  /** The Organization's newest Release; null when it has none. */
  readonly latestRelease: Release | null;
  /** Epoch milliseconds. */
  readonly now: number;
};

const UNIT_MS: Readonly<Record<DurationUnit, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

// --- predicates ---

function isSearchable(state: IssueState): boolean {
  return state.status !== 'deleting' && state.status !== 'merging';
}

function compares({ actual, op, expected }: { actual: number; op: Comparison; expected: number }): boolean {
  switch (op) {
    case '=':
      return actual === expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
  }
}

function globMatches({ glob, value, anywhere }: { glob: string; value: string; anywhere: boolean }): boolean {
  const body = glob
    .split('*')
    .map((part) => part.replace(/[\\^$.|?+()[\]{}]/g, '\\$&'))
    .join('.*');
  return anywhere ? new RegExp(body, 'isu').test(value) : new RegExp(`^${body}$`, 'su').test(value);
}

function anyMatches({ globs, values }: { globs: readonly string[]; values: readonly string[] }): boolean {
  return globs.some((glob) => values.some((value) => globMatches({ glob, value, anywhere: false })));
}

function sameEmail({ left, right }: { left: string; right: string }): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isStanding({ value, issue }: { value: IsValue; issue: IssueFacts }): boolean {
  const { state } = issue;
  switch (value) {
    case 'unresolved':
    case 'resolved':
    case 'archived':
      return state.status === value;
    case 'new':
    case 'ongoing':
    case 'escalating':
    case 'regressed':
      return state.status === 'unresolved' && state.substatus === value;
    case 'for_review':
      return state.forReviewSince !== null;
    case 'assigned':
      return issue.assignee !== null;
    case 'unassigned':
      return issue.assignee === null;
    case 'linked':
      return issue.linked;
    case 'unlinked':
      return !issue.linked;
  }
}

function isAssignedTo({ value, issue, context }: { value: string; issue: IssueFacts; context: SearchContext }): boolean {
  const { assignee } = issue;
  if (value === 'none') return assignee === null;
  if (assignee === null) return false;
  if (value.startsWith('#')) return 'team' in assignee && assignee.team === value.slice(1);
  const email = value === 'me' ? context.viewerEmail : value;
  return 'memberEmail' in assignee && sameEmail({ left: assignee.memberEmail, right: email });
}

function hasRelease({ value, issue, context }: { value: string; issue: IssueFacts; context: SearchContext }): boolean {
  if (value !== 'latest') return anyMatches({ globs: [value], values: issue.releases });
  return context.latestRelease !== null && issue.releases.includes(context.latestRelease);
}

function fieldMatches({
  key,
  value,
  issue,
  context,
}: {
  key: FieldKey;
  value: string;
  issue: IssueFacts;
  context: SearchContext;
}): boolean {
  switch (key) {
    case 'assigned':
      return isAssignedTo({ value, issue, context });
    case 'release':
      return hasRelease({ value, issue, context });
    case 'environment':
      return anyMatches({ globs: [value], values: issue.environments });
    case 'priority':
      return issue.state.priority.level === value;
    case 'level':
      return issue.level === value;
  }
}

function hasKey({ key, issue }: { key: string; issue: IssueFacts }): boolean {
  if (key === 'release') return issue.releases.length > 0;
  if (key === 'environment') return issue.environments.length > 0;
  return (issue.tags.get(key) ?? []).length > 0;
}

function textMatches({ text, issue }: { text: string; issue: IssueFacts }): boolean {
  return [issue.title, issue.culprit, issue.shortId].some((value) => globMatches({ glob: text, value, anywhere: true }));
}

// --- helpers ---

function durationMs(duration: Duration): number {
  return duration.amount * UNIT_MS[duration.unit];
}

function countOf({ key, issue }: { key: CountKey; issue: IssueFacts }): number {
  if (key === 'timesSeen') return issue.state.count;
  if (key === 'users') return issue.state.userCount;
  return issue.reportCount;
}

function boundHolds({ moment, bound, now }: { moment: number; bound: TimeBound; now: number }): boolean {
  if (bound.kind === 'date') return compares({ actual: moment, op: bound.op, expected: bound.at });
  return compares({ actual: now - moment, op: bound.op, expected: durationMs(bound.duration) });
}

function termHolds({
  term,
  issue,
  context,
}: {
  term: Exclude<QueryTerm, { kind: 'text' }>;
  issue: IssueFacts;
  context: SearchContext;
}): boolean {
  switch (term.kind) {
    case 'is':
      return isStanding({ value: term.value, issue });
    case 'has':
      return hasKey({ key: term.key, issue });
    case 'count':
      return compares({ actual: countOf({ key: term.key, issue }), op: term.op, expected: term.value });
    case 'time': {
      const moment = term.key === 'age' ? issue.state.firstSeen : issue.state.lastSeen;
      return boundHolds({ moment, bound: term.bound, now: context.now });
    }
    case 'field':
      return term.values.some((value) => fieldMatches({ key: term.key, value, issue, context }));
    case 'tag':
      return anyMatches({ globs: term.values, values: issue.tags.get(term.key) ?? [] });
  }
}

function matchesTerm({ term, issue, context }: { term: QueryTerm; issue: IssueFacts; context: SearchContext }): boolean {
  if (term.kind === 'text') return textMatches({ text: term.text, issue });
  return termHolds({ term, issue, context }) !== term.negated;
}

// --- exports ---

/** Whether an Issue matches every term of an Issue Query. */
export function matchesQuery(query: IssueQuery, issue: IssueFacts, context: SearchContext): boolean {
  return isSearchable(issue.state) && query.terms.every((term) => matchesTerm({ term, issue, context }));
}
