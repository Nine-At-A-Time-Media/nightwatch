import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseIssueQuery } from '../../../../src/domain/search/parse.js';
import { matchesQuery, type IssueFacts } from '../../../../src/domain/search/match.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { context, DAY, facts, HOUR, NOW } from './fixtures.js';

function matches(text: string, issue: IssueFacts): boolean {
  const query = parseIssueQuery(text);
  if (isRefusal(query)) throw new Error(query.refusal);
  return matchesQuery(query, issue, context);
}

describe('matchesQuery', () => {
  it('Search: Given issues in several states, When a member searches `is:unresolved assigned:me release:latest`, Then only matching issues are returned', () => {
    const mine = { memberEmail: 'ana@example.com' };
    const issues = [
      facts({ assignee: mine, releases: ['web@1.9.0', 'web@2.0.0'] }, { issueId: 'match' }),
      facts(
        { assignee: mine, releases: ['web@2.0.0'] },
        { issueId: 'resolved', status: { status: 'resolved', resolution: { kind: 'plain' } } },
      ),
      facts({ assignee: { memberEmail: 'bo@example.com' }, releases: ['web@2.0.0'] }, { issueId: 'theirs' }),
      facts({ assignee: mine, releases: ['web@1.9.0'] }, { issueId: 'old-release' }),
      facts({ assignee: null, releases: ['web@2.0.0'] }, { issueId: 'unassigned' }),
    ];
    expect(issues.filter((issue) => matches('is:unresolved assigned:me release:latest', issue)).map((i) => i.state.issueId)).toEqual([
      'match',
    ]);
  });

  it('matches every issue with an empty query, and none that is being deleted or merged', () => {
    expect(matches('', facts())).toBe(true);
    expect(matches('', facts({}, { status: { status: 'deleting' } }))).toBe(false);
    expect(matches('', facts({}, { status: { status: 'merging' } }))).toBe(false);
  });

  it.each([
    ['is:unresolved', true],
    ['is:ongoing', true],
    ['is:new', false],
    ['!is:resolved', true],
    ['is:archived', false],
    ['is:for_review', false],
    ['is:unassigned', true],
    ['is:assigned', false],
    ['is:unlinked', true],
    ['is:linked', false],
  ])('reads status and standing: %s is %s for an ongoing, unassigned, unlinked issue', (text, expected) => {
    expect(matches(text, facts())).toBe(expected);
  });

  it('reads substatus, For Review and links on other issues', () => {
    expect(matches('is:archived', facts({}, { status: { status: 'archived', substatus: 'forever', spam: false } }))).toBe(true);
    expect(matches('is:regressed', facts({}, { status: { status: 'unresolved', substatus: 'regressed' } }))).toBe(true);
    expect(matches('is:new', facts({}, { status: { status: 'resolved', resolution: { kind: 'plain' } } }))).toBe(false);
    expect(matches('is:for_review', facts({}, { forReviewSince: NOW - HOUR }))).toBe(true);
    expect(matches('is:linked', facts({ linked: true }))).toBe(true);
  });

  it('matches free text against title, culprit and Short Id, ignoring case, with wildcards', () => {
    expect(matches('typeerror', facts())).toBe(true);
    expect(matches('checkout/cart', facts())).toBe(true);
    expect(matches('web-3k', facts())).toBe(true);
    expect(matches('"cannot read*undefined"', facts())).toBe(true);
    expect(matches('timeout', facts())).toBe(false);
  });

  it('matches assignees: me, none, an email and a team', () => {
    const team = facts({ assignee: { team: 'web' } });
    const ana = facts({ assignee: { memberEmail: 'Ana@Example.com' } });
    expect(matches('assigned:me', ana)).toBe(true);
    expect(matches('assigned:ana@example.com', ana)).toBe(true);
    expect(matches('assigned:none', facts())).toBe(true);
    expect(matches('assigned:#web', team)).toBe(true);
    expect(matches('assigned:me', team)).toBe(false);
    expect(matches('assigned:[none, #web]', team)).toBe(true);
  });

  it('matches releases, environments, priority and level, with wildcards and negation', () => {
    expect(matches('release:web@1.*', facts())).toBe(true);
    expect(matches('release:latest', facts())).toBe(false);
    expect(matches('!release:latest', facts())).toBe(true);
    expect(matches('environment:[staging, production]', facts())).toBe(true);
    expect(matches('!environment:production', facts())).toBe(false);
    expect(matches('priority:medium level:error', facts())).toBe(true);
    expect(matches('priority:high', facts())).toBe(false);
  });

  it('matches no issue on release:latest when the Organization has no Release', () => {
    const query = parseIssueQuery('release:latest');
    if (isRefusal(query)) throw new Error(query.refusal);
    expect(matchesQuery(query, facts({ releases: ['web@2.0.0'] }), { ...context, latestRelease: null })).toBe(false);
  });

  it('matches tags in both spellings, and has: on tags, releases and environments', () => {
    expect(matches('browser:Firefox*', facts())).toBe(true);
    expect(matches('tags[os.name]:Linux', facts())).toBe(true);
    expect(matches('tags[os.name]:linux', facts())).toBe(false);
    expect(matches('has:browser !has:url', facts())).toBe(true);
    expect(matches('has:release has:environment', facts())).toBe(true);
    expect(matches('has:release', facts({ releases: [] }))).toBe(false);
  });

  it('compares counts, users and Report presence', () => {
    expect(matches('timesSeen:12 users:>=3', facts())).toBe(true);
    expect(matches('timesSeen:>12', facts())).toBe(false);
    expect(matches('reports:>0', facts())).toBe(false);
    expect(matches('reports:>0', facts({ reportCount: 2 }))).toBe(true);
  });

  it('compares age and last seen as time elapsed, and dates as moments', () => {
    expect(matches('age:-3d lastSeen:-2h', facts())).toBe(true);
    expect(matches('age:-24h', facts())).toBe(false);
    expect(matches('age:+24h', facts())).toBe(true);
    expect(matches('lastSeen:>30m', facts())).toBe(true);
    expect(matches(`lastSeen:>${new Date(NOW - DAY).toISOString()}`, facts())).toBe(true);
    expect(matches(`age:<${new Date(NOW - DAY).toISOString()}`, facts())).toBe(true);
  });

  it('negating a term inverts it on any issue', () => {
    const term = fc.constantFrom(
      'is:unresolved',
      'assigned:me',
      'release:latest',
      'browser:Fire*',
      'reports:>0',
      'age:-1d',
      'has:url',
      'priority:high',
    );
    const issue = fc.record({
      reportCount: fc.nat({ max: 3 }),
      linked: fc.boolean(),
      releases: fc.subarray(['web@1.9.0', 'web@2.0.0']),
      assignee: fc.constantFrom(null, { memberEmail: 'ana@example.com' }, { team: 'web' }),
    });
    fc.assert(
      fc.property(term, issue, (text, overrides) => {
        expect(matches(`!${text}`, facts(overrides))).toBe(!matches(text, facts(overrides)));
      }),
    );
  });
});
