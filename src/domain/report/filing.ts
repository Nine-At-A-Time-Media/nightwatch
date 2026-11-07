/**
 * Filing -- the values a reporter's side of Reports exchanges (design
 * Reports, Filing, Identity, Reference and My reports; Behaviors: Reports):
 * the report form, the Filing Receipt, the Outcome of a filing, the
 * Follow-up Page link, and a reporter's list of their own Reports.
 *
 * The form never asks who the reporter is: their identity comes from their
 * Sign-in. A filing is in the `feedback` data category, one Report each.
 */

import type { OrganizationId, ProjectId, ReportId } from '../ids.js';
import type { Outcome, OutcomeKind } from '../outcome/outcome.js';
import type { RetryAdviceEntry } from '../protocol/retry-advice.js';
import type { Refusal } from '../refusal.js';
import type { SignIn } from '../signin/sign-in.js';
import type { ReportReference } from './reference.js';
import type { Reporter } from './report.js';
import type { ReportStatus } from './status.js';

const REPORT_ATTACHMENTS_PREFIX = 'attachments/reports/';

export const REPORT_FORM_FIELDS = ['message', 'screenshot', 'associatedEventId'] as const;

export type ReportFormField = (typeof REPORT_FORM_FIELDS)[number];

/** The report form: the fields it asks for, and who the reporter is signed in as (shown, never asked). */
export type ReportForm = { readonly reporter: Reporter; readonly fields: readonly ReportFormField[] };

/** What the reporter gets back at filing: the Report Reference at once, and its Follow-up Page link. */
export type FilingReceipt = {
  readonly reportId: ReportId;
  readonly reference: ReportReference;
  readonly followUpUrl: string;
  /** Whether the receipt notice reached the Mailer; the Report is filed either way. */
  readonly noticeSent: boolean;
  readonly outcome: Outcome;
};

/** A refused filing, with the Outcome it records and, when a Quota refused it, when to retry. */
export type FilingRefusal = Refusal & { readonly outcome?: Outcome; readonly advice?: RetryAdviceEntry; readonly retryable?: boolean };

/**
 * Settings the Reports use cases read, supplied by the composition root.
 * - followUpBaseUrl: where the console serves Follow-up Pages.
 * - maxMessageLength: the bound on a Report's message.
 * - spamThreshold: the Spam Judge threshold.
 */
export type ReportSettings = {
  readonly followUpBaseUrl: string;
  readonly maxMessageLength: number;
  readonly spamThreshold: number;
};

/** One of a reporter's own Reports, as their list shows it. */
export type ReportListEntry = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly reportId: ReportId;
  readonly reference: ReportReference;
  readonly message: string;
  readonly filedAt: number;
  readonly status: ReportStatus;
};

export type ReportList = { readonly reports: readonly ReportListEntry[] };

// --- helpers ---

/** The report form for a signed-in reporter. */
export function reportForm(signIn: SignIn): ReportForm {
  return { reporter: { email: signIn.email }, fields: REPORT_FORM_FIELDS };
}

/** The Outcome of one filing. */
export function filingOutcome(entry: { projectId: ProjectId; kind: OutcomeKind; reason: string | null; at: number }): Outcome {
  return { projectId: entry.projectId, recordedAt: entry.at, kind: entry.kind, reason: entry.reason, category: 'feedback', quantity: 1 };
}

/** The BlobStore key of a Report's screenshot. */
export function reportAttachmentKey(reportId: ReportId): string {
  return `${REPORT_ATTACHMENTS_PREFIX}${reportId}`;
}

/** The Follow-up Page link of a Report Reference. */
export function followUpUrl(baseUrl: string, reference: ReportReference): string {
  return `${baseUrl.replace(/\/+$/, '')}/follow-up/${reference}`;
}
