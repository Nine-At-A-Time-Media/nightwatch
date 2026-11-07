/**
 * fileReport -- a signed-in reporter files a Report (design Behaviors:
 * Reports, the filing rows; Reports, Filing, Identity, Reference, Attachment
 * and Quota). In order: the Assertion must verify against the issuers the
 * Project's Organization trusts; the submission must validate; the Report
 * Quota must allow it. Then the screenshot is stored and a Report Reference
 * is indexed by its hash, and only then is the Report attached to its own
 * Report issue in the Project, so a storage failure files nothing and the
 * refusal says to retry (the server side of "Failed send is visible"). The
 * receipt notice goes to the reporter's address whatever the form shows.
 *
 * Ports: SignInVerifier, QuotaGate, ProjectClient, ControlStore, BlobStore,
 * EffectQueue, Mailer, Ids, Clock. The Project comes from the route that
 * received the submission, never from the reporter.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../../domain/ids.js';
import { isRefusal } from '../../domain/refusal.js';
import {
  filingOutcome,
  followUpUrl,
  reportAttachmentKey,
  type FilingReceipt,
  type FilingRefusal,
  type ReportSettings,
} from '../../domain/report/filing.js';
import { receiptNotice } from '../../domain/report/notice.js';
import { validateSubmission, type Report, type ReportSubmission } from '../../domain/report/report.js';
import type { Assertion, SignIn } from '../../domain/signin/sign-in.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { Ids } from '../../ports/ids.js';
import type { Mailer } from '../../ports/mailer.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { QuotaGate } from '../../ports/quota-gate.js';
import type { SignInVerifier } from '../../ports/sign-in-verifier.js';
import { verifyAssertion } from '../signin/verify-assertion.js';
import { mintReference } from './mint-reference.js';

/** A Report Quota is per Project; a Report filed in Nightwatch's form carries no Client Key. */
const NO_CLIENT_KEY = '';

export type FileReportDeps = {
  verifier: SignInVerifier;
  quota: QuotaGate;
  projects: ProjectClient;
  control: ControlStore;
  blobs: BlobStore;
  effects: EffectQueue;
  mailer: Mailer;
  ids: Ids;
  clock: Clock;
  settings: ReportSettings;
};

type Filing = { projectId: ProjectId; organizationId: OrganizationId; signIn: SignIn; submission: ReportSubmission; at: number };

// --- helpers ---

function invalid(projectId: ProjectId, reason: string, at: number): FilingRefusal {
  return { refusal: reason, outcome: filingOutcome({ projectId, kind: 'invalid', reason, at }) };
}

function unavailable(stored: Durability): FilingRefusal | null {
  return stored.ok ? null : { refusal: 'unavailable', retryable: stored.retryable };
}

function reportOf(filing: Filing, ids: { reportId: ReportId; issueId: string; referenceHash: string; attachments: string[] }): Report {
  return {
    id: ids.reportId,
    projectId: filing.projectId,
    issueId: ids.issueId,
    reporter: { email: filing.signIn.email },
    message: filing.submission.message,
    attachments: ids.attachments,
    associatedEventId: filing.submission.associatedEventId,
    filedAt: filing.at,
    spam: false,
    unsubscribed: false,
    referenceHash: ids.referenceHash,
  };
}

// --- flow: checks ---

async function admit(
  projectId: ProjectId,
  input: { submission: ReportSubmission; assertion: Assertion | null },
  deps: FileReportDeps,
): Promise<Filing | FilingRefusal> {
  const at = deps.clock.now();
  const organizationId = await deps.control.organizationOf(projectId);
  if (organizationId === null) return invalid(projectId, 'unknown-project', at);
  const signIn = await verifyAssertion(organizationId, input.assertion, deps);
  if (isRefusal(signIn)) return invalid(projectId, 'unsigned', at);
  const submission = validateSubmission(input.submission, { maxMessageLength: deps.settings.maxMessageLength });
  if (isRefusal(submission)) return invalid(projectId, submission.refusal, at);
  const decision = await deps.quota.check({ projectId, publicKey: NO_CLIENT_KEY, category: 'feedback', quantity: 1 });
  if (!decision.allowed) {
    const outcome = filingOutcome({ projectId, kind: 'rate_limited', reason: decision.advice.reason, at });
    return { refusal: 'rate-limited', advice: decision.advice, outcome };
  }
  return { projectId, organizationId, signIn, submission, at };
}

// --- flow: storing ---

async function storeScreenshot(reportId: ReportId, screenshot: Uint8Array | null, blobs: BlobStore): Promise<string[] | FilingRefusal> {
  if (screenshot === null) return [];
  const key = reportAttachmentKey(reportId);
  return unavailable(await blobs.put(key, screenshot)) ?? [key];
}

async function sendReceipt(report: Report, link: { reference: string; url: string }, mailer: Mailer): Promise<boolean> {
  const notice = receiptNotice({ reference: link.reference, link: link.url });
  const sent = await mailer.send({ to: report.reporter.email, subject: notice.subject, text: notice.text, headers: {} });
  return sent.ok;
}

async function file(filing: Filing, deps: FileReportDeps): Promise<FilingReceipt | FilingRefusal> {
  const reportId = deps.ids.newId();
  const attachments = await storeScreenshot(reportId, filing.submission.screenshot, deps.blobs);
  if (isRefusal(attachments)) return attachments;
  const minted = await mintReference({ organizationId: filing.organizationId, projectId: filing.projectId, reportId }, deps);
  const notStored = unavailable(minted.stored);
  if (notStored) return notStored;
  const report = reportOf(filing, { reportId, issueId: deps.ids.newId(), referenceHash: minted.hash, attachments });
  await deps.effects.enqueue(await deps.projects.openReportIssue(filing.projectId, report));
  const url = followUpUrl(deps.settings.followUpBaseUrl, minted.reference);
  const noticeSent = await sendReceipt(report, { reference: minted.reference, url }, deps.mailer);
  const outcome = filingOutcome({ projectId: filing.projectId, kind: 'accepted', reason: null, at: filing.at });
  return { reportId, reference: minted.reference, followUpUrl: url, noticeSent, outcome };
}

// --- exports ---

export async function fileReport(
  project: ProjectId,
  submission: ReportSubmission,
  assertion: Assertion | null,
  deps: FileReportDeps,
): Promise<FilingReceipt | FilingRefusal> {
  const filing = await admit(project, { submission, assertion }, deps);
  return isRefusal(filing) ? filing : file(filing, deps);
}
