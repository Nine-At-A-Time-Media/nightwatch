/**
 * Report Form -- the reporter's side of filing a Report (design Reports;
 * Domain Language: Report Submission, Report Reference, Follow-up Page).
 * Pure: the form's states and moves (idle -> editing -> sending -> sent |
 * failed), the message rule, the Report Submission it builds, and the plain
 * words it shows for each Refusal. The form never holds a name or address;
 * the reporter's identity travels with their sign-in.
 *
 * The message rule mirrors the root package's validateSubmission
 * (src/domain/report/report.ts); the server stays the authority.
 */

import { isRefusal, refusal, type Refusal } from './refusal.js';

// --- constants ---

const ACCEPTED_SCREENSHOT_TYPES: readonly string[] = ['image/png', 'image/jpeg'];

const WORDING: Readonly<Record<string, string>> = {
  'empty-message': 'Write a message before sending.',
  'message-too-long': 'Your message is too long.',
  'invalid-screenshot': 'The screenshot must be a PNG or JPEG image.',
  'not-signed-in': 'You are not signed in.',
  'too-many-reports': 'Too many reports right now, try again later.',
  'not-sent': 'Your report was not sent.',
  'unreadable-receipt': 'Your report may have been sent, but no reference came back.',
};

const UNKNOWN_REFUSAL_WORDING = 'Your report was not accepted.';

// --- types ---

/** The bounds a message must fit, supplied by the embedding page. */
export type SubmissionLimits = { readonly maxMessageLength: number };

/** What the reporter has typed and attached so far. */
export type ReportDraft = { readonly message: string; readonly screenshot: Blob | null };

/** What the form sends: the only fields Nightwatch asks a reporter for, plus the embedding context. */
export type ReportSubmission = {
  readonly project: string;
  readonly message: string;
  readonly screenshot: Blob | null;
  readonly associatedEventId: string | null;
};

/** What Nightwatch returns when a Report is filed: its Report Reference, Report Status and Follow-up Page link. */
export type FilingReceipt = { readonly reference: string; readonly status: string; readonly followUpUrl: string };

export type ReportFormState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'editing'; readonly draft: ReportDraft; readonly refusal: Refusal | null }
  | { readonly phase: 'sending'; readonly draft: ReportDraft }
  | { readonly phase: 'sent'; readonly receipt: FilingReceipt }
  | { readonly phase: 'failed'; readonly draft: ReportDraft; readonly refusal: Refusal };

export type ReportFormEvent =
  | { readonly kind: 'open' }
  | { readonly kind: 'edit'; readonly draft: ReportDraft }
  | { readonly kind: 'submit' }
  | { readonly kind: 'sent'; readonly receipt: FilingReceipt }
  | { readonly kind: 'failed'; readonly refusal: Refusal }
  | { readonly kind: 'cancel' };

// --- message and screenshot rules ---

function isBlank(message: string): boolean {
  return message.trim() === '';
}

/** A screenshot must be a PNG or JPEG image. */
export function isAcceptedScreenshot(type: string): boolean {
  return ACCEPTED_SCREENSHOT_TYPES.includes(type);
}

/** The message must be non-blank and within the bound. */
export function validateMessage(message: string, limits: SubmissionLimits): string | Refusal {
  if (isBlank(message)) return refusal('empty-message');
  if (message.length > limits.maxMessageLength) return refusal('message-too-long');
  return message;
}

function draftRefusal(draft: ReportDraft, limits: SubmissionLimits): Refusal | null {
  const message = validateMessage(draft.message, limits);
  if (isRefusal(message)) return message;
  if (draft.screenshot !== null && !isAcceptedScreenshot(draft.screenshot.type)) return refusal('invalid-screenshot');
  return null;
}

/** Builds the Report Submission from a draft, or the Refusal that stops it. */
export function submissionOf(input: {
  readonly draft: ReportDraft;
  readonly project: string;
  readonly associatedEventId: string | null;
  readonly limits: SubmissionLimits;
}): ReportSubmission | Refusal {
  const problem = draftRefusal(input.draft, input.limits);
  if (problem !== null) return problem;
  return {
    project: input.project,
    message: input.draft.message,
    screenshot: input.draft.screenshot,
    associatedEventId: input.associatedEventId,
  };
}

// --- state machine ---

function submitted(draft: ReportDraft, limits: SubmissionLimits): ReportFormState {
  const problem = draftRefusal(draft, limits);
  return problem === null ? { phase: 'sending', draft } : { phase: 'editing', draft, refusal: problem };
}

function fromIdle(state: ReportFormState, event: ReportFormEvent): ReportFormState {
  return event.kind === 'open' ? { phase: 'editing', draft: { message: '', screenshot: null }, refusal: null } : state;
}

function fromDraft(state: ReportFormState, draft: ReportDraft, event: ReportFormEvent, limits: SubmissionLimits): ReportFormState {
  if (event.kind === 'edit') return { phase: 'editing', draft: event.draft, refusal: null };
  if (event.kind === 'submit') return submitted(draft, limits);
  if (event.kind === 'cancel') return { phase: 'idle' };
  return state;
}

function fromSending(state: ReportFormState, draft: ReportDraft, event: ReportFormEvent): ReportFormState {
  if (event.kind === 'sent') return { phase: 'sent', receipt: event.receipt };
  if (event.kind === 'failed') return { phase: 'failed', draft, refusal: event.refusal };
  return state;
}

function fromSent(state: ReportFormState, event: ReportFormEvent): ReportFormState {
  return event.kind === 'cancel' ? { phase: 'idle' } : state;
}

/** The Report Form's next state; an event that does not apply to the current phase changes nothing. */
export function nextReportFormState(state: ReportFormState, event: ReportFormEvent, limits: SubmissionLimits): ReportFormState {
  switch (state.phase) {
    case 'idle':
      return fromIdle(state, event);
    case 'editing':
    case 'failed':
      return fromDraft(state, state.draft, event, limits);
    case 'sending':
      return fromSending(state, state.draft, event);
    case 'sent':
      return fromSent(state, event);
  }
}

// --- wording ---

/** Only a send that never arrived is worth repeating unchanged. */
export function isRetryable(reason: Refusal): boolean {
  return reason.refusal === 'not-sent';
}

/** The plain words the form shows for a Refusal. */
export function failureWording(reason: Refusal): string {
  return WORDING[reason.refusal] ?? UNKNOWN_REFUSAL_WORDING;
}
