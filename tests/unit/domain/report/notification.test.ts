import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reporterNotificationFor, reporterNotificationForComment } from '../../../../src/domain/report/notification.js';
import type { Report } from '../../../../src/domain/report/report.js';
import { REPORT_STATUSES, reportStatusOf } from '../../../../src/domain/report/status.js';
import type { Comment } from '../../../../src/domain/report/thread.js';
import { issueIn } from '../issue/fixtures.js';

const T0 = Date.UTC(2026, 10, 1);

function reportOf(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    projectId: 'project-1',
    issueId: 'issue-1',
    reporter: { email: 'ada@example.com' },
    message: 'it broke',
    attachments: [],
    associatedEventId: null,
    filedAt: T0,
    spam: false,
    unsubscribed: false,
    referenceHash: 'hash-1',
    ...overrides,
  };
}

const sharedComment: Comment = { id: 'c1', author: { member: 'm1' }, shared: true, text: 'fixed in 1.2', at: T0 };
const privateComment: Comment = { id: 'c2', author: { member: 'm1' }, shared: false, text: 'cache bug', at: T0 };
const replyComment: Comment = { id: 'c3', author: { report: 'report-1' }, shared: true, text: 'thanks', at: T0 };
const status = fc.constantFrom(...REPORT_STATUSES);

describe('Reporter Notification', () => {
  it('Status change notifies: Given a Report whose reporter is subscribed, When its issue is resolved, Then the reporter is notified that the Report is Fixed', () => {
    expect(reporterNotificationFor('acknowledged', 'fixed', reportOf())).toEqual({
      reportId: 'report-1',
      to: 'ada@example.com',
      about: { status: 'fixed' },
    });
  });

  it('Fix ships: Given a Fixed Report, When the resolving release is seen, Then the reporter is notified it is Released', () => {
    expect(reporterNotificationFor('fixed', 'released', reportOf())).toMatchObject({ about: { status: 'released' } });
  });

  it('sends nothing when the shown status did not change', () => {
    fc.assert(
      fc.property(status, (same) => {
        expect(reporterNotificationFor(same, same, reportOf())).toBeNull();
      }),
    );
  });

  it('Duplicate reports share outcome: Given two Reports moved onto one issue, When that issue is resolved, Then both Reports become Fixed and both reporters are notified', () => {
    const facts = { triage: { assigned: true, commentedByMember: false }, releasesSeen: new Map<string, number>(), lastShown: 'acknowledged' as const };
    const before = reportStatusOf(issueIn({ status: 'unresolved', substatus: 'ongoing' }), null, facts);
    const after = reportStatusOf(issueIn({ status: 'resolved', resolution: { kind: 'plain' } }), null, facts);
    const first = reportOf();
    const second = reportOf({ id: 'report-2', reporter: { email: 'bob@example.com' } });
    expect(after).toBe('fixed');
    expect([first, second].map((report) => reporterNotificationFor(before, after, report))).toEqual([
      { reportId: 'report-1', to: 'ada@example.com', about: { status: 'fixed' } },
      { reportId: 'report-2', to: 'bob@example.com', about: { status: 'fixed' } },
    ]);
  });

  it('Spam is silent: Given a Report marked spam, Then its reporter is told nothing of any change or comment', () => {
    fc.assert(
      fc.property(status, status, (before, after) => {
        expect(reporterNotificationFor(before, after, reportOf({ spam: true }))).toBeNull();
      }),
    );
    expect(reporterNotificationForComment(sharedComment, reportOf({ spam: true }))).toBeNull();
  });

  it('Unsubscribe: Given a reporter who unsubscribed from a Report, When its status changes, Then no Reporter Notification is sent', () => {
    fc.assert(
      fc.property(status, status, (before, after) => {
        expect(reporterNotificationFor(before, after, reportOf({ unsubscribed: true }))).toBeNull();
      }),
    );
    expect(reporterNotificationForComment(sharedComment, reportOf({ unsubscribed: true }))).toBeNull();
  });

  it('Shared reply reaches reporter: Given a team member comments and marks it shared, When the comment is saved, Then the reporter is notified', () => {
    expect(reporterNotificationForComment(sharedComment, reportOf())).toEqual({
      reportId: 'report-1',
      to: 'ada@example.com',
      about: { comment: 'c1' },
    });
  });

  it('Private comment stays private: Given a team member comments without marking it shared, When the comment is saved, Then the reporter is told nothing', () => {
    expect(reporterNotificationForComment(privateComment, reportOf())).toBeNull();
  });

  it("a reporter's own reply notifies no reporter", () => {
    expect(reporterNotificationForComment(replyComment, reportOf())).toBeNull();
    expect(reporterNotificationForComment(replyComment, reportOf({ id: 'report-2' }))).toBeNull();
  });
});
