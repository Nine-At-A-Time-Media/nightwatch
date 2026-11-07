import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Actor, IssueChange, IssueChangeKind } from '../../../../src/domain/issue/state.js';
import type { Report } from '../../../../src/domain/report/report.js';
import {
  expectedStateAfter,
  outboundChangeFor,
  outboundIssueBody,
  type OutboundIssueFacts,
} from '../../../../src/domain/tracker/outbound.js';

function statusChange(from: string, to: string, actor: Actor = { member: 'm1' }): IssueChange {
  return { issueId: 'i1', kind: 'status', from, to, actor, origin: actor === 'tracker' ? 'tracker' : 'nightwatch', at: 1 };
}

const FACTS: OutboundIssueFacts = {
  title: 'TypeError: x is undefined',
  culprit: 'app/checkout.ts in pay',
  evidenceUrl: 'https://console.example/organizations/o/issues/i1',
  counts: { events: 12, users: 3 },
  firstSeen: Date.UTC(2026, 10, 1),
  lastSeen: Date.UTC(2026, 10, 6, 12, 30),
  reportCount: 2,
};

const label = fc.constantFrom(
  'unresolved/new',
  'unresolved/ongoing',
  'unresolved/escalating',
  'unresolved/regressed',
  'resolved',
  'archived/until_escalating',
  'archived/until_condition',
  'archived/forever',
  'deleting',
  'merging',
);
const actor = fc.constantFrom<Actor>({ member: 'm1' }, 'system', 'tracker', 'commit', 'sweep');
const anyChange: fc.Arbitrary<IssueChange> = fc.record({
  issueId: fc.constant('i1'),
  kind: fc.constantFrom<IssueChangeKind>('status', 'priority', 'resolution', 'for_review'),
  from: fc.option(label, { nil: null }),
  to: fc.option(label, { nil: null }),
  actor,
  origin: fc.constantFrom('nightwatch' as const, 'tracker' as const),
  at: fc.nat(),
});

describe('Outbound change', () => {
  it('Nightwatch resolve closes GitHub: Given a linked issue, When a member resolves it, Then GitHub is to be closed as completed', () => {
    expect(outboundChangeFor(statusChange('unresolved/ongoing', 'resolved'))).toEqual({ kind: 'close', reason: 'completed' });
  });

  it('archiving forever closes GitHub as not planned', () => {
    expect(outboundChangeFor(statusChange('unresolved/new', 'archived/forever'))).toEqual({ kind: 'close', reason: 'not_planned' });
  });

  it('unresolving, regressing, or unarchiving a forever-archived issue reopens GitHub', () => {
    expect(outboundChangeFor(statusChange('resolved', 'unresolved/ongoing'))).toEqual({ kind: 'reopen' });
    expect(outboundChangeFor(statusChange('resolved', 'unresolved/regressed', 'system'))).toEqual({ kind: 'reopen' });
    expect(outboundChangeFor(statusChange('archived/forever', 'unresolved/ongoing'))).toEqual({ kind: 'reopen' });
  });

  it('changes GitHub never saw as a close send nothing', () => {
    expect(outboundChangeFor(statusChange('archived/until_escalating', 'unresolved/ongoing'))).toEqual({ kind: 'none' });
    expect(outboundChangeFor(statusChange('unresolved/new', 'archived/until_escalating'))).toEqual({ kind: 'none' });
    expect(outboundChangeFor(statusChange('unresolved/new', 'unresolved/ongoing'))).toEqual({ kind: 'none' });
    expect(outboundChangeFor({ ...statusChange('unresolved/new', 'resolved'), kind: 'resolution' })).toEqual({ kind: 'none' });
  });

  it('No echo: a change that came from the tracker is never sent back', () => {
    fc.assert(
      fc.property(anyChange, (change) => {
        fc.pre(change.origin === 'tracker');
        expect(outboundChangeFor(change)).toEqual({ kind: 'none' });
      }),
    );
  });

  it('the expected GitHub state after a change is what the change asks for', () => {
    expect(expectedStateAfter({ kind: 'close', reason: 'completed' })).toEqual({ state: 'closed', reason: 'completed' });
    expect(expectedStateAfter({ kind: 'close', reason: 'not_planned' })).toEqual({ state: 'closed', reason: 'not_planned' });
    expect(expectedStateAfter({ kind: 'reopen' })).toEqual({ state: 'open' });
    expect(expectedStateAfter({ kind: 'none' })).toBeNull();
  });
});

describe('Outbound issue body', () => {
  it('carries the title, culprit, counts, dates, Report count and evidence link', () => {
    const body = outboundIssueBody(FACTS);
    expect(body).toContain('`TypeError: x is undefined`');
    expect(body).toContain('`app/checkout.ts in pay`');
    expect(body).toContain('| Events | 12 |');
    expect(body).toContain('| Users | 3 |');
    expect(body).toContain('| Reports | 2 |');
    expect(body).toContain('2026-11-01T00:00:00.000Z');
    expect(body).toContain('2026-11-06T12:30:00.000Z');
    expect(body).toContain('(<https://console.example/organizations/o/issues/i1>)');
  });

  it('event text cannot break out of its code span, mention anyone, or add lines', () => {
    const body = outboundIssueBody({ ...FACTS, title: 'a ``x`` @team\n# heading', culprit: '' });
    expect(body).toContain('```a ``x`` @team # heading```');
    expect(body).not.toMatch(/^# heading/m);
    expect(body).toContain('| Culprit | (none) |');
  });

  it('an evidence link with markup characters stays one link', () => {
    const body = outboundIssueBody({ ...FACTS, evidenceUrl: 'https://c.example/a b>c' });
    expect(body).toContain('(<https://c.example/a%20b%3Ec>)');
  });

  it('Contact never leaves: Given a Report, When an issue body is posted to GitHub, Then the reporter address and Attachments are absent', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.string(),
        fc.string(),
        fc.array(fc.stringMatching(/^att\/[a-z0-9]{8,16}$/), { minLength: 1, maxLength: 3 }),
        (email, title, culprit, attachments) => {
          fc.pre(!title.includes(email) && !culprit.includes(email));
          const report: Report = {
            id: 'r1',
            projectId: 'p1',
            issueId: 'i1',
            reporter: { email },
            message: `from ${email}`,
            attachments,
            associatedEventId: null,
            filedAt: 1,
            spam: false,
            unsubscribed: false,
            referenceHash: 'h',
          };
          const facts = { ...FACTS, title, culprit, ...report };
          const body = outboundIssueBody(facts);
          expect(body).not.toContain(email);
          for (const key of attachments) expect(body).not.toContain(key);
        },
      ),
    );
  });
});
