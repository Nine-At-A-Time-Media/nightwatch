/**
 * ReportSender -- the seam between the Report Form and the way a Report
 * Submission reaches Nightwatch (in the browser: a same-origin POST to the
 * product's tunnel route). It never throws for a refusal; it returns one.
 */

import type { Refusal } from '../domain/refusal.js';
import type { FilingReceipt, ReportSubmission } from '../domain/report-form.js';

export interface ReportSender {
  /** Sends a Report Submission to the endpoint and returns its Filing Receipt or the Refusal. */
  send(endpoint: string, submission: ReportSubmission): Promise<FilingReceipt | Refusal>;
}
