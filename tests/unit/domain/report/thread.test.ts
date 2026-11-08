import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../../../src/domain/report/report.js';
import { followUpView, isShared, threadOf, type Comment } from '../../../../src/domain/report/thread.js';

const T0 = Date.UTC(2026, 10, 1);

const report: Report = {
  id: 'report-1',
  projectId: 'project-1',
  issueId: 'issue-1',
  reporter: { email: 'ada@example.com' },
  message: 'the save button does nothing',
  attachments: ['att-1'],
  associatedEventId: 'event-1',
  filedAt: T0,
  spam: false,
  unsubscribed: false,
  referenceHash: 'hash-1',
};

const shared: Comment = { id: 'c1', author: { member: 'm1' }, shared: true, text: 'we are on it', at: T0 + 2 };
const privateNote: Comment = { id: 'c2', author: { member: 'm1' }, shared: false, text: 'looks like the cache', at: T0 + 1 };
const reply: Comment = { id: 'c3', author: { report: 'report-1' }, shared: true, text: 'thanks', at: T0 + 3 };
const otherReply: Comment = { id: 'c4', author: { report: 'report-2' }, shared: true, text: 'me too', at: T0 + 4 };

const changes = [
  { status: 'received', at: T0 },
  { status: 'acknowledged', at: T0 + 2 },
] as const;

describe('Thread', () => {
  it("holds the issue's shared Member Comments and this Report's reporter replies, oldest first", () => {
    expect(threadOf(report, [reply, otherReply, privateNote, shared])).toEqual([shared, reply]);
  });

  it("a reporter's Comment is always shared; a Member's only when marked", () => {
    expect(isShared(reply)).toBe(true);
    expect(isShared(shared)).toBe(true);
    expect(isShared(privateNote)).toBe(false);
  });
});

describe('Follow-up View', () => {
  it('Follow-up Page shows status: Given a Report Reference, When its reporter opens its Follow-up Page, Then they see the Report Status, the shared Thread and change dates, and nothing else about the issue', () => {
    const view = followUpView({ report, status: 'acknowledged', changes, comments: [privateNote, shared, reply, otherReply] });
    expect(view).toEqual({
      status: 'acknowledged',
      thread: [
        { author: 'team', text: 'we are on it', at: T0 + 2 },
        { author: 'you', text: 'thanks', at: T0 + 3 },
      ],
      changes: [
        { status: 'received', at: T0 },
        { status: 'acknowledged', at: T0 + 2 },
      ],
    });
    expect(Object.keys(view).sort()).toEqual(['changes', 'status', 'thread']);
    expect(JSON.stringify(view)).not.toMatch(/m1|issue-1|project-1|att-1|event-1|ada@|save button|hash-1/);
  });

  it('Private comment stays private: Given a team member comments without marking it shared, When the comment is saved, Then the Thread does not change', () => {
    const before = followUpView({ report, status: 'acknowledged', changes, comments: [shared] });
    const after = followUpView({ report, status: 'acknowledged', changes, comments: [shared, privateNote] });
    expect(after).toEqual(before);
  });

  it('Private comment stays private: no private Comment ever appears in a Follow-up View', () => {
    const author = fc.oneof(
      fc.record({ member: fc.constantFrom('m1', 'm2') }),
      fc.record({ report: fc.constantFrom('report-1', 'report-2') }),
    );
    const comment = fc
      .record({ author, shared: fc.boolean(), at: fc.nat() })
      .map(({ author: by, shared: marked, at }): Omit<Comment, 'id' | 'text'> =>
        'member' in by ? { author: by, shared: marked, at } : { author: by, shared: true, at },
      );
    fc.assert(
      fc.property(fc.array(comment), (drafts) => {
        const comments = drafts.map((draft, index) => ({ ...draft, id: `c${index}`, text: `text-${index}` }) as Comment);
        const view = followUpView({ report, status: 'received', changes: [], comments });
        const shown = new Set(view.thread.map((entry) => entry.text));
        for (const c of comments) {
          if ('member' in c.author && !c.shared) expect(shown.has(c.text)).toBe(false);
          if ('report' in c.author && c.author.report !== report.id) expect(shown.has(c.text)).toBe(false);
        }
      }),
    );
  });
});
