import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { canViewFollowUp, validateSubmission, type Report } from '../../../../src/domain/report/report.js';
import type { SignIn } from '../../../../src/domain/signin/sign-in.js';

const LIMITS = { maxMessageLength: 100 };

const report: Report = {
  id: 'report-1',
  projectId: 'project-1',
  issueId: 'issue-1',
  reporter: { email: 'ada@example.com' },
  message: 'the save button does nothing',
  attachments: [],
  associatedEventId: null,
  filedAt: Date.UTC(2026, 10, 1),
  spam: false,
  unsubscribed: false,
  referenceHash: 'hash-1',
};

function signInAs(email: string): SignIn {
  return { email, issuer: 'https://acme.cloudflareaccess.com', audience: 'aud', expiresAt: new Date('2026-11-08T00:00:00Z') };
}

describe('Report Submission', () => {
  it('keeps the message, the optional screenshot and the optional associated event', () => {
    const screenshot = new Uint8Array([1, 2, 3]);
    expect(validateSubmission({ message: '  it broke  ', screenshot, associatedEventId: 'abc' }, LIMITS)).toEqual({
      message: '  it broke  ',
      screenshot,
      associatedEventId: 'abc',
    });
    expect(validateSubmission({ message: 'it broke' }, LIMITS)).toEqual({ message: 'it broke', screenshot: null, associatedEventId: null });
    expect(validateSubmission({ message: 'it broke', screenshot: null, associatedEventId: null }, LIMITS)).toEqual({
      message: 'it broke',
      screenshot: null,
      associatedEventId: null,
    });
  });

  it('Empty message refused: Given a message that is empty, When the reporter submits, Then the Report is not filed and the form says why', () => {
    expect(validateSubmission({ message: '' }, LIMITS)).toEqual({ refusal: 'empty-message' });
    expect(validateSubmission({}, LIMITS)).toEqual({ refusal: 'empty-message' });
    expect(validateSubmission({ message: 42 }, LIMITS)).toEqual({ refusal: 'empty-message' });
  });

  it('refuses a message of only whitespace as empty', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(' ', '\t', '\n', '\r', ' ', ' ')), (chars) => {
        expect(validateSubmission({ message: chars.join('') }, LIMITS)).toEqual({ refusal: 'empty-message' });
      }),
    );
  });

  it('refuses a message longer than the bound, and accepts one exactly at it', () => {
    expect(validateSubmission({ message: 'x'.repeat(100) }, LIMITS)).toMatchObject({ message: 'x'.repeat(100) });
    expect(validateSubmission({ message: 'x'.repeat(101) }, LIMITS)).toEqual({ refusal: 'message-too-long' });
  });

  it('refuses a screenshot that is not bytes and an associated event that is not text', () => {
    expect(validateSubmission({ message: 'm', screenshot: 'data:image/png' }, LIMITS)).toEqual({ refusal: 'invalid-screenshot' });
    expect(validateSubmission({ message: 'm', associatedEventId: 7 }, LIMITS)).toEqual({ refusal: 'invalid-associated-event' });
    expect(validateSubmission({ message: 'm', associatedEventId: '' }, LIMITS)).toEqual({ refusal: 'invalid-associated-event' });
  });

  it('accepts every non-blank message within the bound, unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((message) => message.trim() !== ''),
        (message) => {
          const result = validateSubmission({ message }, LIMITS);
          expect(isRefusal(result)).toBe(false);
          expect(result).toMatchObject({ message });
        },
      ),
    );
  });
});

describe('Follow-up Page access', () => {
  it('the reporter may open the Follow-up Page of their own Report, whatever the case of their address', () => {
    expect(canViewFollowUp(signInAs('ada@example.com'), report, false)).toBe(true);
    expect(canViewFollowUp(signInAs('Ada@Example.com'), report, false)).toBe(true);
  });

  it('a Member of its Project may open any Report of that Project', () => {
    expect(canViewFollowUp(signInAs('member@acme.test'), report, true)).toBe(true);
  });

  it('Follow-up Page refuses others: Given a Report Reference, When a signed-in person who is neither its reporter nor a Member of its Project opens it, Then the page is not shown', () => {
    expect(canViewFollowUp(signInAs('mallory@example.com'), report, false)).toBe(false);
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        fc.pre(email.toLowerCase() !== report.reporter.email);
        expect(canViewFollowUp(signInAs(email), report, false)).toBe(false);
      }),
    );
  });
});
