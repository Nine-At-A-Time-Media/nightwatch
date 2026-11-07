import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  failureWording,
  isAcceptedScreenshot,
  isRetryable,
  nextReportFormState,
  submissionOf,
  validateMessage,
  type ReportDraft,
  type ReportFormState,
} from '../../src/domain/report-form.js';
import { refusal } from '../../src/domain/refusal.js';

const limits = { maxMessageLength: 20 };
const draft: ReportDraft = { message: 'it broke', screenshot: null };
const receipt = { reference: 'ref-1', status: 'received', followUpUrl: 'https://console.example.com/r/ref-1' };

function editing(over: Partial<ReportDraft> = {}): ReportFormState {
  return { phase: 'editing', draft: { ...draft, ...over }, refusal: null };
}

describe('validateMessage', () => {
  it('accepts exactly the messages that are non-blank once trimmed and within the bound', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.integer({ min: 0, max: 40 }), (message, maxMessageLength) => {
        const accepted = message.trim() !== '' && message.length <= maxMessageLength;
        const result = validateMessage(message, { maxMessageLength });
        expect(result).toEqual(accepted ? message : expect.objectContaining({ refusal: expect.any(String) }));
      }),
    );
  });

  it('Empty message refused: Given a message that is empty, When the reporter submits, Then it is refused as empty-message', () => {
    expect(validateMessage('   ', limits)).toEqual(refusal('empty-message'));
  });

  it('refuses a message one character over the bound as message-too-long', () => {
    expect(validateMessage('x'.repeat(21), limits)).toEqual(refusal('message-too-long'));
    expect(validateMessage('x'.repeat(20), limits)).toBe('x'.repeat(20));
  });
});

describe('isAcceptedScreenshot', () => {
  it('accepts PNG and JPEG images only', () => {
    expect(isAcceptedScreenshot('image/png')).toBe(true);
    expect(isAcceptedScreenshot('image/jpeg')).toBe(true);
    expect(isAcceptedScreenshot('image/gif')).toBe(false);
    expect(isAcceptedScreenshot('')).toBe(false);
  });
});

describe('submissionOf', () => {
  it('builds the Report Submission from the draft and the embedding context', () => {
    const screenshot = new Blob(['png'], { type: 'image/png' });
    expect(submissionOf({ draft: { message: 'it broke', screenshot }, project: 'p1', associatedEventId: 'e1', limits })).toEqual({
      project: 'p1',
      message: 'it broke',
      screenshot,
      associatedEventId: 'e1',
    });
  });

  it('refuses a screenshot that is not PNG or JPEG', () => {
    const screenshot = new Blob(['gif'], { type: 'image/gif' });
    expect(submissionOf({ draft: { message: 'x', screenshot }, project: 'p1', associatedEventId: null, limits })).toEqual(
      refusal('invalid-screenshot'),
    );
  });
});

describe('Report Form state machine', () => {
  it('opens an empty draft from idle', () => {
    expect(nextReportFormState({ phase: 'idle' }, { kind: 'open' }, limits)).toEqual({
      phase: 'editing',
      draft: { message: '', screenshot: null },
      refusal: null,
    });
  });

  it('keeps edits in the draft', () => {
    expect(nextReportFormState(editing(), { kind: 'edit', draft: { message: 'new', screenshot: null } }, limits)).toEqual(
      editing({ message: 'new' }),
    );
  });

  it('moves a valid draft to sending on submit', () => {
    expect(nextReportFormState(editing(), { kind: 'submit' }, limits)).toEqual({ phase: 'sending', draft });
  });

  it('Empty message refused: Given an empty draft, When the reporter submits, Then the form stays editing and says why', () => {
    expect(nextReportFormState(editing({ message: '' }), { kind: 'submit' }, limits)).toEqual({
      phase: 'editing',
      draft: { message: '', screenshot: null },
      refusal: refusal('empty-message'),
    });
  });

  it('shows the Filing Receipt once sent', () => {
    expect(nextReportFormState({ phase: 'sending', draft }, { kind: 'sent', receipt }, limits)).toEqual({ phase: 'sent', receipt });
  });

  it('Failed send is visible: Given a send that failed, When the form updates, Then it is failed and keeps the draft', () => {
    expect(nextReportFormState({ phase: 'sending', draft }, { kind: 'failed', refusal: refusal('not-sent') }, limits)).toEqual({
      phase: 'failed',
      draft,
      refusal: refusal('not-sent'),
    });
  });

  it('retries a failed draft by submitting it again', () => {
    const failed: ReportFormState = { phase: 'failed', draft, refusal: refusal('not-sent') };
    expect(nextReportFormState(failed, { kind: 'submit' }, limits)).toEqual({ phase: 'sending', draft });
  });

  it('closes to idle on cancel, but not while sending', () => {
    expect(nextReportFormState(editing(), { kind: 'cancel' }, limits)).toEqual({ phase: 'idle' });
    expect(nextReportFormState({ phase: 'sent', receipt }, { kind: 'cancel' }, limits)).toEqual({ phase: 'idle' });
    expect(nextReportFormState({ phase: 'sending', draft }, { kind: 'cancel' }, limits)).toEqual({ phase: 'sending', draft });
  });

  it('ignores an event that does not apply to the current phase', () => {
    expect(nextReportFormState({ phase: 'idle' }, { kind: 'sent', receipt }, limits)).toEqual({ phase: 'idle' });
    expect(nextReportFormState(editing(), { kind: 'open' }, limits)).toEqual(editing());
    expect(nextReportFormState({ phase: 'sending', draft }, { kind: 'submit' }, limits)).toEqual({ phase: 'sending', draft });
    expect(nextReportFormState({ phase: 'sent', receipt }, { kind: 'edit', draft }, limits)).toEqual({ phase: 'sent', receipt });
  });
});

describe('failure wording', () => {
  it('says each refusal in plain words', () => {
    expect(failureWording(refusal('empty-message'))).toBe('Write a message before sending.');
    expect(failureWording(refusal('message-too-long'))).toBe('Your message is too long.');
    expect(failureWording(refusal('invalid-screenshot'))).toBe('The screenshot must be a PNG or JPEG image.');
    expect(failureWording(refusal('not-signed-in'))).toBe('You are not signed in.');
    expect(failureWording(refusal('too-many-reports'))).toBe('Too many reports right now, try again later.');
    expect(failureWording(refusal('not-sent'))).toBe('Your report was not sent.');
    expect(failureWording(refusal('something-new'))).toBe('Your report was not accepted.');
  });

  it('offers Retry only for a send that did not arrive', () => {
    expect(isRetryable(refusal('not-sent'))).toBe(true);
    expect(isRetryable(refusal('empty-message'))).toBe(false);
    expect(isRetryable(refusal('too-many-reports'))).toBe(false);
  });
});
