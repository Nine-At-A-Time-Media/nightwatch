/**
 * Report -- a bug report a person filed, attached to exactly one Issue
 * (design Reports; Domain Language: Report, Reporter, Report Submission).
 * Validates what a reporter sends, and decides who may open a Report's
 * Follow-up Page: its Reporter, or a Member of its Project.
 *
 * Times are epoch milliseconds. The Reporter's address is the one a Sign-in
 * asserted, lowercased; Nightwatch never asks for it.
 */

import { refusal, type Refusal } from '../refusal.js';
import type { SignIn } from '../signin/sign-in.js';

/** The person who filed a Report, identified by the address a trusted Sign-in asserted. */
export type Reporter = { readonly email: string };

export type Report = {
  readonly id: string;
  readonly projectId: string;
  /** The Issue the Report is attached to. */
  readonly issueId: string;
  readonly reporter: Reporter;
  readonly message: string;
  /** Blob keys of the Report's Attachments. */
  readonly attachments: readonly string[];
  readonly associatedEventId: string | null;
  readonly filedAt: number;
  readonly spam: boolean;
  readonly unsubscribed: boolean;
  /** The hash of its Report Reference; the reference itself is never stored. */
  readonly referenceHash: string;
};

/** What a reporter sends: a message, an optional screenshot, an optional associated event. */
export type ReportSubmission = {
  readonly message: string;
  readonly screenshot: Uint8Array | null;
  readonly associatedEventId: string | null;
};

/** The fields of a submission as received; nothing in it is trusted yet. */
export type SubmissionFields = Readonly<Record<string, unknown>>;

/** The bounds a submission must fit, supplied by the composition root. */
export type SubmissionLimits = { readonly maxMessageLength: number };

// --- predicates ---

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function isBlank(message: string): boolean {
  return message.trim() === '';
}

function isSameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// --- helpers ---

function screenshotOf(value: unknown): Uint8Array | null | Refusal {
  if (isAbsent(value)) return null;
  return value instanceof Uint8Array ? value : refusal('invalid-screenshot');
}

function associatedEventOf(value: unknown): string | null | Refusal {
  if (isAbsent(value)) return null;
  return typeof value === 'string' && value !== '' ? value : refusal('invalid-associated-event');
}

// --- exports ---

/** Validates a submission: the message must be non-blank and within the bound; the rest is optional. */
export function validateSubmission(fields: SubmissionFields, limits: SubmissionLimits): ReportSubmission | Refusal {
  const message = fields['message'];
  if (typeof message !== 'string' || isBlank(message)) return refusal('empty-message');
  if (message.length > limits.maxMessageLength) return refusal('message-too-long');
  const screenshot = screenshotOf(fields['screenshot']);
  if (screenshot !== null && !(screenshot instanceof Uint8Array)) return screenshot;
  const associatedEventId = associatedEventOf(fields['associatedEventId']);
  if (associatedEventId !== null && typeof associatedEventId !== 'string') return associatedEventId;
  return { message, screenshot, associatedEventId };
}

/** Only the Report's Reporter, or a Member of its Project, may open its Follow-up Page. */
export function canViewFollowUp(signIn: SignIn, report: Report, isProjectMember: boolean): boolean {
  return isProjectMember || isSameAddress(signIn.email, report.reporter.email);
}
