import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Status } from '../../../../src/domain/issue/state.js';
import {
  REPORT_STATUSES,
  reportStatusOf,
  type IssueTriage,
  type ReportStatus,
  type ReportStatusFacts,
} from '../../../../src/domain/report/status.js';
import type { ExternalLink } from '../../../../src/domain/tracker/external-link.js';
import { issueIn } from '../issue/fixtures.js';

type LinkStanding = Pick<ExternalLink, 'state'>;

const UNTRIAGED: IssueTriage = { assigned: false, commentedByMember: false };
const NONE_SEEN = new Map<string, number>();
const SEEN = new Map([['1.2.0', 1]]);
const condition = { untilDate: 1, count: null, window: null, userCount: null, userWindow: null, baselineCount: 0, baselineUserCount: 0 };

function facts(overrides: Partial<ReportStatusFacts> = {}): ReportStatusFacts {
  return { triage: UNTRIAGED, releasesSeen: NONE_SEEN, lastShown: 'received', ...overrides };
}

function statusFor(status: Status, link: LinkStanding | null = null, overrides: Partial<ReportStatusFacts> = {}): ReportStatus {
  return reportStatusOf(issueIn(status), link, facts(overrides));
}

const reportStatus = fc.constantFrom(...REPORT_STATUSES);
const anyStatus: fc.Arbitrary<Status> = fc.oneof(
  fc.constantFrom<Status>(
    { status: 'unresolved', substatus: 'new' },
    { status: 'unresolved', substatus: 'ongoing' },
    { status: 'unresolved', substatus: 'escalating' },
    { status: 'unresolved', substatus: 'regressed' },
    { status: 'resolved', resolution: { kind: 'plain' } },
    { status: 'resolved', resolution: { kind: 'in_release', release: '1.2.0' } },
    { status: 'resolved', resolution: { kind: 'in_release', release: '9.9.9' } },
    { status: 'resolved', resolution: { kind: 'in_next_release', release: null } },
    { status: 'resolved', resolution: { kind: 'in_commit', commit: 'abc', release: '1.2.0' } },
    { status: 'archived', substatus: 'until_escalating' },
    { status: 'archived', substatus: 'until_condition', condition },
    { status: 'archived', substatus: 'forever', spam: false },
    { status: 'archived', substatus: 'forever', spam: true },
  ),
);
const anyTriage = fc.record({ assigned: fc.boolean(), commentedByMember: fc.boolean() });
const anyLink = fc.constantFrom<LinkStanding | null>(null, { state: 'linked' }, { state: 'broken' });

describe('Report Status', () => {
  it('Received: the attached issue is Unresolved/New and no member has triaged it', () => {
    expect(statusFor({ status: 'unresolved', substatus: 'new' })).toBe('received');
  });

  it('Acknowledged: an Unresolved/New issue that is assigned, commented on, or linked externally', () => {
    const fresh: Status = { status: 'unresolved', substatus: 'new' };
    expect(statusFor(fresh, null, { triage: { assigned: true, commentedByMember: false } })).toBe('acknowledged');
    expect(statusFor(fresh, null, { triage: { assigned: false, commentedByMember: true } })).toBe('acknowledged');
    expect(statusFor(fresh, { state: 'linked' })).toBe('acknowledged');
    expect(statusFor(fresh, { state: 'broken' })).toBe('acknowledged');
  });

  it('Acknowledged: an Unresolved issue past New, untriaged or not', () => {
    for (const substatus of ['ongoing', 'escalating', 'regressed'] as const) {
      expect(statusFor({ status: 'unresolved', substatus })).toBe('acknowledged');
    }
  });

  it('Acknowledged: an issue Archived until escalating or until condition', () => {
    expect(statusFor({ status: 'archived', substatus: 'until_escalating' })).toBe('acknowledged');
    expect(statusFor({ status: 'archived', substatus: 'until_condition', condition })).toBe('acknowledged');
  });

  it('Fixed: Resolved, and its Resolution names no release that has been seen', () => {
    expect(statusFor({ status: 'resolved', resolution: { kind: 'plain' } }, null, { releasesSeen: SEEN })).toBe('fixed');
    expect(statusFor({ status: 'resolved', resolution: { kind: 'in_next_release', release: null } }, null, { releasesSeen: SEEN })).toBe(
      'fixed',
    );
    expect(
      statusFor({ status: 'resolved', resolution: { kind: 'in_commit', commit: 'abc', release: null } }, null, { releasesSeen: SEEN }),
    ).toBe('fixed');
    expect(statusFor({ status: 'resolved', resolution: { kind: 'in_release', release: '1.3.0' } }, null, { releasesSeen: SEEN })).toBe(
      'fixed',
    );
  });

  it('Released: Resolved, and its Resolution release has been seen', () => {
    expect(statusFor({ status: 'resolved', resolution: { kind: 'in_release', release: '1.2.0' } }, null, { releasesSeen: SEEN })).toBe(
      'released',
    );
    expect(statusFor({ status: 'resolved', resolution: { kind: 'in_next_release', release: '1.2.0' } }, null, { releasesSeen: SEEN })).toBe(
      'released',
    );
    expect(
      statusFor({ status: 'resolved', resolution: { kind: 'in_commit', commit: 'abc', release: '1.2.0' } }, null, { releasesSeen: SEEN }),
    ).toBe('released');
  });

  it('Fix ships: Given a Fixed Report, When the resolving release is seen, Then the Report Status becomes Released', () => {
    const resolved: Status = { status: 'resolved', resolution: { kind: 'in_release', release: '1.2.0' } };
    expect(statusFor(resolved, null, { releasesSeen: NONE_SEEN })).toBe('fixed');
    expect(statusFor(resolved, null, { releasesSeen: SEEN, lastShown: 'fixed' })).toBe('released');
  });

  it('Closed: Archived forever and not spam', () => {
    expect(statusFor({ status: 'archived', substatus: 'forever', spam: false })).toBe('closed');
  });

  it('Spam is silent: Given a Report, When it is marked spam, Then its Follow-up Page keeps the last status shown', () => {
    fc.assert(
      fc.property(reportStatus, anyTriage, anyLink, (lastShown, triage, link) => {
        expect(statusFor({ status: 'archived', substatus: 'forever', spam: true }, link, { lastShown, triage })).toBe(lastShown);
      }),
    );
  });

  it('an issue being deleted or merged keeps the last status shown', () => {
    expect(statusFor({ status: 'deleting' }, null, { lastShown: 'fixed' })).toBe('fixed');
    expect(statusFor({ status: 'merging' }, null, { lastShown: 'acknowledged' })).toBe('acknowledged');
  });

  it('Duplicate reports share outcome: Given two Reports on one issue, Then both have the same Report Status whatever each showed before', () => {
    fc.assert(
      fc.property(anyStatus, anyTriage, anyLink, reportStatus, reportStatus, (status, triage, link, shownA, shownB) => {
        fc.pre(!(status.status === 'archived' && status.substatus === 'forever' && status.spam));
        const a = statusFor(status, link, { triage, releasesSeen: SEEN, lastShown: shownA });
        const b = statusFor(status, link, { triage, releasesSeen: SEEN, lastShown: shownB });
        expect(a).toBe(b);
      }),
    );
  });

  it('only an untriaged Unresolved/New issue reads as Received', () => {
    fc.assert(
      fc.property(anyStatus, anyTriage, anyLink, (status, triage, link) => {
        fc.pre(!(status.status === 'archived' && status.substatus === 'forever' && status.spam));
        const untriagedNew =
          status.status === 'unresolved' && status.substatus === 'new' && !triage.assigned && !triage.commentedByMember && link === null;
        expect(statusFor(status, link, { triage, lastShown: 'closed' }) === 'received').toBe(untriagedNew);
      }),
    );
  });
});
