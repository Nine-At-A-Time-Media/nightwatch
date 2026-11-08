import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { erasureOf } from '../../../../src/domain/report/erasure.js';
import { filingOutcome, followUpUrl, REPORT_FORM_FIELDS, reportForm } from '../../../../src/domain/report/filing.js';
import { commentNotice, receiptNotice, statusNotice } from '../../../../src/domain/report/notice.js';
import { createReportIssue, isEmptyReportIssue } from '../../../../src/domain/report/report-issue.js';
import { isJudgedSpam, type SpamVerdict } from '../../../../src/domain/report/spam.js';
import { commentRecorded, lastShownStatus, triageOf, type Comment } from '../../../../src/domain/report/thread.js';
import { issueIn } from '../issue/fixtures.js';

const T0 = Date.UTC(2026, 10, 1);

describe('Report issue', () => {
  it('a new Report starts on its own Report issue: Unresolved/New, in For Review, with no events', () => {
    const opened = createReportIssue({ issueId: 'issue-9', at: T0 });
    expect(opened.state).toMatchObject({
      issueId: 'issue-9',
      status: 'unresolved',
      substatus: 'new',
      count: 0,
      userCount: 0,
      forReviewSince: T0,
    });
    expect(opened.changes.map((c) => [c.kind, c.to, c.actor])).toEqual([
      ['status', 'unresolved/new', 'system'],
      ['for_review', 'in', 'system'],
    ]);
  });

  it('an Issue left with no Report and no Fingerprint is empty', () => {
    expect(isEmptyReportIssue({ reports: 0, fingerprints: 0 })).toBe(true);
    expect(isEmptyReportIssue({ reports: 1, fingerprints: 0 })).toBe(false);
    expect(isEmptyReportIssue({ reports: 0, fingerprints: 2 })).toBe(false);
  });
});

describe('Spam Judge threshold', () => {
  const verdict = (v: SpamVerdict['verdict'], confidence: number | null): SpamVerdict => ({ verdict: v, confidence });

  it('archives only a spam verdict at or above the threshold', () => {
    expect(isJudgedSpam(verdict('spam', 0.95), 0.9)).toBe(true);
    expect(isJudgedSpam(verdict('spam', 0.9), 0.9)).toBe(true);
    expect(isJudgedSpam(verdict('spam', 0.89), 0.9)).toBe(false);
    expect(isJudgedSpam(verdict('not_spam', 0.99), 0.9)).toBe(false);
    expect(isJudgedSpam(verdict('abstain', 0.99), 0.9)).toBe(false);
  });

  it('an uncalibrated verdict never meets a threshold', () => {
    expect(isJudgedSpam(verdict('spam', null), 0)).toBe(false);
  });

  it('a verdict below the threshold never archives a Report automatically', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (confidence, threshold) => {
        fc.pre(confidence < threshold);
        expect(isJudgedSpam(verdict('spam', confidence), threshold)).toBe(false);
      }),
    );
  });
});

describe('Thread facts', () => {
  const shared: Comment = { id: 'c1', author: { member: 'm1' }, shared: true, text: 'on it', at: T0 + 2 };
  const privateNote: Comment = { id: 'c2', author: { member: 'm1' }, shared: false, text: 'cache?', at: T0 + 1 };
  const reply: Comment = { id: 'c3', author: { report: 'report-1' }, shared: true, text: 'thanks', at: T0 + 3 };

  it('a shared Member Comment triages the Issue; a private one or a reporter reply does not', () => {
    expect(triageOf([shared], null)).toEqual({ assigned: false, commentedByMember: true });
    expect(triageOf([privateNote, reply], null)).toEqual({ assigned: false, commentedByMember: false });
  });

  it('an Assignee, Member or Team, triages the Issue', () => {
    expect(triageOf([], { member: 'm1' })).toEqual({ assigned: true, commentedByMember: false });
    expect(triageOf([privateNote], { team: 'web' })).toEqual({ assigned: true, commentedByMember: false });
  });

  it('the last shown Report Status is the latest change, Received before any', () => {
    expect(lastShownStatus([])).toBe('received');
    expect(
      lastShownStatus([
        { status: 'received', at: T0 },
        { status: 'fixed', at: T0 + 5 },
        { status: 'acknowledged', at: T0 + 2 },
      ]),
    ).toBe('fixed');
  });

  it('a saved Comment is one comment change naming the Comment and nothing it says', () => {
    const state = issueIn({ status: 'unresolved', substatus: 'new' });
    expect(commentRecorded(state, reply, 'reporter')).toEqual({
      issueId: state.issueId,
      kind: 'comment',
      from: null,
      to: 'c3',
      actor: 'reporter',
      origin: 'nightwatch',
      at: T0 + 3,
    });
  });
});

describe('Filing', () => {
  it('the report form asks for a message, a screenshot and an associated event, never a name or an address', () => {
    const form = reportForm({ email: 'ada@example.com', issuer: 'i', audience: 'a', expiresAt: new Date(T0) });
    expect(form).toEqual({ reporter: { email: 'ada@example.com' }, fields: ['message', 'screenshot', 'associatedEventId'] });
    expect(REPORT_FORM_FIELDS.some((field) => /name|email|address/i.test(field))).toBe(false);
  });

  it('a filing Outcome is in the feedback category, for one Report', () => {
    expect(filingOutcome({ projectId: 'p1', kind: 'invalid', reason: 'unsigned', at: T0 })).toEqual({
      projectId: 'p1',
      recordedAt: T0,
      kind: 'invalid',
      reason: 'unsigned',
      category: 'feedback',
      quantity: 1,
    });
  });

  it('the Follow-up Page link is the base URL and the Report Reference, with one slash between', () => {
    expect(followUpUrl('https://console.example/', 'ref')).toBe('https://console.example/follow-up/ref');
    expect(followUpUrl('https://console.example', 'ref')).toBe('https://console.example/follow-up/ref');
  });
});

describe('Notices', () => {
  const link = 'https://console.example/follow-up/ref';

  it('the filing receipt carries the Report Reference and the Follow-up Page link', () => {
    const notice = receiptNotice({ reference: 'REF123', link });
    expect(notice.text).toContain('REF123');
    expect(notice.text).toContain(link);
  });

  it('a status notice names the new Report Status and links the Follow-up Page', () => {
    const notice = statusNotice({ status: 'fixed', link });
    expect(notice.subject).toMatch(/fixed/i);
    expect(notice.text).toContain(link);
  });

  it('a comment notice carries the shared reply and links the Follow-up Page', () => {
    const notice = commentNotice({ text: 'a fix is on its way', link });
    expect(notice.text).toContain('a fix is on its way');
    expect(notice.text).toContain(link);
  });
});

describe('Erasure', () => {
  it('is complete only when every store it reached was erased', () => {
    expect(erasureOf({ reports: 2, failed: [] })).toEqual({ reports: 2, complete: true, incomplete: [] });
    expect(erasureOf({ reports: 2, failed: ['control', 'blobs', 'control'] })).toEqual({
      reports: 2,
      complete: false,
      incomplete: ['blobs', 'control'],
    });
  });
});
