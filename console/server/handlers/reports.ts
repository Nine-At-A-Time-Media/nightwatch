/**
 * The reporter's entry points: filing a Report (the widget's HTTP contract,
 * widget/README.md), the report form, the Follow-up Page and its reply box,
 * and the reporter's own list. Each parses the request, calls one use case
 * with the deps the route built, and shapes the answer; a Refusal answers
 * with its reason only, so nothing else about the Issue leaves.
 */

import { fileReport, type FileReportDeps } from '#nightwatch/application/reports/file-report.js';
import { listMyReports, type ListMyReportsDeps } from '#nightwatch/application/reports/list-my-reports.js';
import { openReportForm, type OpenReportFormDeps } from '#nightwatch/application/reports/open-report-form.js';
import { replyAsReporter, type ReplyAsReporterDeps } from '#nightwatch/application/reports/reply-as-reporter.js';
import { viewFollowUp, type ViewFollowUpDeps } from '#nightwatch/application/reports/view-follow-up.js';
import { retryAfterSeconds } from '#nightwatch/domain/protocol/retry-advice.js';
import { isRefusal, refusal, type Refusal } from '#nightwatch/domain/refusal.js';
import type { FilingRefusal } from '#nightwatch/domain/report/filing.js';
import type { ReportSubmission } from '#nightwatch/domain/report/report.js';
import { assertionOf, json, jsonBodyOf, refusedWith, type AssertionSources } from './http.js';

export type Entry = { readonly assertions: AssertionSources };

/** The Report Status every Report is filed in. */
const FILED_STATUS = 'received';
const SCREENSHOT_TYPES = ['image/png', 'image/jpeg'];
const UNSIGNED = refusal('unsigned');

/** A filing as the widget posts it, parsed but not yet validated. */
type ParsedFiling = { readonly project: string; readonly submission: ReportSubmission };

// --- predicates ---

function isScreenshotType(type: string): boolean {
  return SCREENSHOT_TYPES.includes(type);
}

// --- helpers ---

function textField(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' && value !== '' ? value : null;
}

function rateLimited(refused: FilingRefusal): Response {
  const headers: Record<string, string> = refused.advice ? { 'retry-after': String(retryAfterSeconds([refused.advice])) } : {};
  return refusedWith(refused, headers);
}

// --- flow: parsing ---

async function formOf(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function screenshotOf(form: FormData): Promise<Uint8Array | null | Refusal> {
  const file = form.get('screenshot');
  if (file === null || typeof file === 'string' || file.size === 0) return null;
  if (!isScreenshotType(file.type)) return refusal('invalid-screenshot');
  return new Uint8Array(await file.arrayBuffer());
}

async function filingOf(request: Request): Promise<ParsedFiling | Refusal> {
  const form = await formOf(request);
  if (form === null) return refusal('invalid-form');
  const project = textField(form, 'project');
  if (project === null) return refusal('unknown-project');
  const screenshot = await screenshotOf(form);
  if (isRefusal(screenshot)) return screenshot;
  const message = form.get('message');
  return {
    project,
    submission: {
      message: typeof message === 'string' ? message : '',
      screenshot,
      associatedEventId: textField(form, 'associatedEventId'),
    },
  };
}

// --- exports ---

/** POST /api/report -- 201 with the Filing Receipt the widget shows, or the Refusal's status and reason. */
export async function handleFileReport(request: Request, deps: FileReportDeps & Entry): Promise<Response> {
  const filing = await filingOf(request);
  if (isRefusal(filing)) return refusedWith(filing);
  const receipt = await fileReport(filing.project, filing.submission, assertionOf(request, deps.assertions), deps);
  if (isRefusal(receipt)) return rateLimited(receipt);
  return json(201, { reference: receipt.reference, status: FILED_STATUS, followUpUrl: receipt.followUpUrl });
}

/** GET /api/report-form?project= -- the fields the form asks for and who the reporter is signed in as. */
export async function handleReportForm(request: Request, deps: OpenReportFormDeps & Entry): Promise<Response> {
  const assertion = assertionOf(request, deps.assertions);
  if (assertion === null) return refusedWith(UNSIGNED);
  const project = new URL(request.url).searchParams.get('project') ?? '';
  const form = await openReportForm(project, assertion, deps);
  return isRefusal(form) ? refusedWith(form) : json(200, form);
}

/** GET /api/follow-up/:reference -- the Follow-up View, or 404 for anyone but its reporter and the Project's Members. */
export async function handleViewFollowUp(request: Request, reference: string, deps: ViewFollowUpDeps & Entry): Promise<Response> {
  const assertion = assertionOf(request, deps.assertions);
  if (assertion === null) return refusedWith(UNSIGNED);
  const view = await viewFollowUp(reference, assertion, deps);
  return isRefusal(view) ? refusedWith(view) : json(200, view);
}

/** POST /api/follow-up/:reference/reply with `{"text"}` -- 201 once the reply is in the Thread. */
export async function handleReplyAsReporter(request: Request, reference: string, deps: ReplyAsReporterDeps & Entry): Promise<Response> {
  const assertion = assertionOf(request, deps.assertions);
  if (assertion === null) return refusedWith(UNSIGNED);
  const body = await jsonBodyOf(request);
  const text = body?.['text'];
  if (typeof text !== 'string') return refusedWith(refusal('empty-message'));
  const replied = await replyAsReporter(reference, { text }, assertion, deps);
  return isRefusal(replied) ? refusedWith(replied) : json(201, { replied: true });
}

/** GET /api/my-reports -- every Report of the signed-in reporter, each with a Report Reference. */
export async function handleListMyReports(request: Request, deps: ListMyReportsDeps & Entry): Promise<Response> {
  const assertion = assertionOf(request, deps.assertions);
  if (assertion === null) return refusedWith(UNSIGNED);
  const list = await listMyReports(assertion, deps);
  return isRefusal(list) ? refusedWith(list) : json(200, list);
}
