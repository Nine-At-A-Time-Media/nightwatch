/**
 * FetchReportSender -- the browser's ReportSender: POSTs a Report Submission
 * as multipart/form-data to the product's same-origin tunnel route, so the
 * product's Access session travels with it, and reads the answer back as a
 * Filing Receipt or a Refusal. Owns the HTTP contract in widget/README.md.
 */

import { refusal, type Refusal } from '../domain/refusal.js';
import type { FilingReceipt, ReportSubmission } from '../domain/report-form.js';
import type { ReportSender } from '../ports/report-sender.js';

// --- types ---

/** The part of fetch this adapter uses; injected so tests need no network. */
export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

// --- predicates ---

function isSafeLink(link: string): boolean {
  if (link.startsWith('/')) return !link.startsWith('//');
  return /^https?:\/\/[^/]/i.test(link);
}

function isFilingReceipt(body: unknown): body is FilingReceipt {
  if (typeof body !== 'object' || body === null) return false;
  const fields = body as Record<string, unknown>;
  return (
    typeof fields['reference'] === 'string' &&
    fields['reference'] !== '' &&
    typeof fields['status'] === 'string' &&
    typeof fields['followUpUrl'] === 'string' &&
    isSafeLink(fields['followUpUrl'])
  );
}

function refusalReasonOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const reason = (body as Record<string, unknown>)['refusal'];
  return typeof reason === 'string' && reason !== '' ? reason : null;
}

// --- helpers ---

function formOf(submission: ReportSubmission): FormData {
  const form = new FormData();
  form.append('project', submission.project);
  form.append('message', submission.message);
  if (submission.screenshot !== null) {
    form.append('screenshot', submission.screenshot, submission.screenshot instanceof File ? submission.screenshot.name : 'screenshot');
  }
  if (submission.associatedEventId !== null) form.append('associatedEventId', submission.associatedEventId);
  return form;
}

function receiptOf(body: unknown): FilingReceipt | Refusal {
  if (!isFilingReceipt(body)) return refusal('unreadable-receipt');
  return { reference: body.reference, status: body.status, followUpUrl: body.followUpUrl };
}

/** Maps an answer's status and body to the Filing Receipt or Refusal it carries. */
function outcomeOf(status: number, body: unknown): FilingReceipt | Refusal {
  if (status >= 200 && status < 300) return receiptOf(body);
  if (status === 401 || status === 403) return refusal('not-signed-in');
  if (status === 429) return refusal('too-many-reports');
  if (status >= 500) return refusal('not-sent');
  return refusal(refusalReasonOf(body) ?? 'invalid-submission');
}

// --- actions ---

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// --- exports ---

export class FetchReportSender implements ReportSender {
  readonly #fetch: FetchFunction;

  constructor(fetchFunction: FetchFunction) {
    this.#fetch = fetchFunction;
  }

  async send(endpoint: string, submission: ReportSubmission): Promise<FilingReceipt | Refusal> {
    let response: Response;
    try {
      response = await this.#fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        body: formOf(submission),
      });
    } catch {
      return refusal('not-sent');
    }
    return outcomeOf(response.status, await bodyOf(response));
  }
}
