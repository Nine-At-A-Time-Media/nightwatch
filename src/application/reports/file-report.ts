/**
 * fileReport -- a signed-in reporter files a Report (design Behaviors:
 * Reports, the filing rows; Reports, Filing, Identity, Reference, Attachment
 * and Quota). In order: the Assertion must verify against the issuers the
 * Project's Organization trusts; the submission must validate; the Report
 * Quota must allow it. Then the screenshot is stored and a Report Reference
 * is indexed by its hash, and only then is the Report attached to its own
 * Report issue in the Project, so a storage failure files nothing and the
 * refusal says to retry (the server side of "Failed send is visible"). The
 * receipt notice goes to the reporter's address whatever the form shows,
 * and whatever the Spam Judge decided, so a spam verdict stays silent.
 *
 * A submission with a filing key is filed once per key and Reporter: the
 * filing is recorded in the Project under its key, and a repeat (an
 * Arrival Record redelivered, an SDK resend, a form double-submit) returns
 * a receipt for the Report filed first, takes no Report Quota, and sends
 * the receipt notice only if the first filing could not. Its Report
 * Reference is newly minted, as only a reference's hash is kept. A repeat
 * whose Report has since been removed files nothing. A key another
 * Reporter used is not theirs to repeat: the submission is filed apart.
 *
 * Ports: SignInVerifier, QuotaGate, ProjectClient, ControlStore, BlobStore,
 * SpamJudge, EffectQueue, Mailer, Ids, Clock. The Project comes from the route that
 * received the submission, never from the reporter.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { OrganizationId, ProjectId, ReportId } from '../../domain/ids.js';
import { isRefusal, refusal } from '../../domain/refusal.js';
import {
  filingOutcome,
  followUpUrl,
  reportAttachmentKey,
  type FilingReceipt,
  type FilingRefusal,
  type RecordedFiling,
  type ReportSettings,
} from '../../domain/report/filing.js';
import { receiptNotice } from '../../domain/report/notice.js';
import { isFiledBy, validateSubmission, type Report, type ReportSubmission } from '../../domain/report/report.js';
import { isJudgedSpam } from '../../domain/report/spam.js';
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
import type { SpamJudge } from '../../ports/spam-judge.js';
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
  spam: SpamJudge;
  effects: EffectQueue;
  mailer: Mailer;
  ids: Ids;
  clock: Clock;
  settings: ReportSettings;
};

type Filing = { projectId: ProjectId; organizationId: OrganizationId; signIn: SignIn; submission: ReportSubmission; at: number };

/** A filing made earlier under the submission's filing key, by the same Reporter. */
type Repeat = { filingKey: string; report: Report; recorded: RecordedFiling };

/** A new filing, and the filing key to record it under, if any. */
type NewFiling = { recordUnder: string | null };

/** What a Report Reference minted for a Report links to. */
type ReceiptLink = { reference: string; url: string };

// --- predicates ---

function isRepeat(recall: Repeat | NewFiling): recall is Repeat {
  return 'report' in recall;
}

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
  return { projectId, organizationId, signIn, submission, at };
}

/** One Report of the Project's Report Quota; null when it allows the filing. */
async function takeQuota(filing: Filing, quota: QuotaGate): Promise<FilingRefusal | null> {
  const { projectId, at } = filing;
  const decision = await quota.check({ projectId, publicKey: NO_CLIENT_KEY, category: 'feedback', quantity: 1 });
  if (decision.allowed) return null;
  const outcome = filingOutcome({ projectId, kind: 'rate_limited', reason: decision.advice.reason, at });
  return { refusal: 'rate-limited', advice: decision.advice, outcome };
}

/** The earlier filing a repeat names; a filing key never used, or used by another Reporter, makes a new filing. */
async function recall(filing: Filing, projects: ProjectClient): Promise<Repeat | NewFiling | FilingRefusal> {
  const { filingKey } = filing.submission;
  if (filingKey === undefined) return { recordUnder: null };
  const recorded = await projects.recallFiling(filing.projectId, filingKey);
  if (recorded === null) return { recordUnder: filingKey };
  const report = await projects.getReport(filing.projectId, recorded.reportId);
  if (report === null) return refusal('already-filed');
  return isFiledBy(report, filing.signIn) ? { filingKey, report, recorded } : { recordUnder: null };
}

// --- flow: storing ---

async function storeScreenshot(reportId: ReportId, screenshot: Uint8Array | null, blobs: BlobStore): Promise<string[] | FilingRefusal> {
  if (screenshot === null) return [];
  const key = reportAttachmentKey(reportId);
  return unavailable(await blobs.put(key, screenshot)) ?? [key];
}

/** Asks the Spam Judge; a verdict at or above the threshold archives the Report, and nothing else follows from it. */
async function judgeSpam(report: Report, deps: FileReportDeps): Promise<void> {
  const verdict = await deps.spam.judge(report.message);
  if (isJudgedSpam(verdict, deps.settings.spamThreshold)) await deps.projects.markSpam(report.projectId, report.id, verdict);
}

async function sendReceipt(report: Report, link: ReceiptLink, mailer: Mailer): Promise<boolean> {
  const notice = receiptNotice({ reference: link.reference, link: link.url });
  const sent = await mailer.send({ to: report.reporter.email, subject: notice.subject, text: notice.text, headers: {} });
  return sent.ok;
}

async function recordFiling(
  filing: { projectId: ProjectId; filingKey: string | null; recorded: RecordedFiling },
  projects: ProjectClient,
): Promise<void> {
  if (filing.filingKey !== null) await projects.recordFiling(filing.projectId, filing.filingKey, filing.recorded);
}

/** Sends the receipt notice and records that it reached the Mailer, so a repeat does not send it again. */
async function notify(notice: { report: Report; link: ReceiptLink; filingKey: string | null }, deps: FileReportDeps): Promise<boolean> {
  const { report, filingKey } = notice;
  const noticeSent = await sendReceipt(report, notice.link, deps.mailer);
  if (noticeSent) await recordFiling({ projectId: report.projectId, filingKey, recorded: { reportId: report.id, noticeSent } }, deps.projects);
  return noticeSent;
}

async function file(filing: Filing, recordUnder: string | null, deps: FileReportDeps): Promise<FilingReceipt | FilingRefusal> {
  const reportId = deps.ids.newId();
  const attachments = await storeScreenshot(reportId, filing.submission.screenshot, deps.blobs);
  if (isRefusal(attachments)) return attachments;
  const minted = await mintReference({ organizationId: filing.organizationId, projectId: filing.projectId, reportId }, deps);
  const notStored = unavailable(minted.stored);
  if (notStored) return notStored;
  const report = reportOf(filing, { reportId, issueId: deps.ids.newId(), referenceHash: minted.hash, attachments });
  await deps.effects.enqueue(await deps.projects.openReportIssue(filing.projectId, report));
  await recordFiling({ projectId: filing.projectId, filingKey: recordUnder, recorded: { reportId, noticeSent: false } }, deps.projects);

  // Milestone: the Report is filed; a repeat of this filing now finds it.
  await judgeSpam(report, deps);
  const url = followUpUrl(deps.settings.followUpBaseUrl, minted.reference);
  const noticeSent = await notify({ report, link: { reference: minted.reference, url }, filingKey: recordUnder }, deps);
  const outcome = filingOutcome({ projectId: filing.projectId, kind: 'accepted', reason: null, at: filing.at });
  return { reportId, reference: minted.reference, followUpUrl: url, noticeSent, outcome };
}

/** A receipt for the Report filed first, with a new Report Reference; the notice goes only if it never reached the Mailer. */
async function repeat(filing: Filing, earlier: Repeat, deps: FileReportDeps): Promise<FilingReceipt | FilingRefusal> {
  const { report, recorded, filingKey } = earlier;
  const minted = await mintReference({ organizationId: filing.organizationId, projectId: filing.projectId, reportId: report.id }, deps);
  const notStored = unavailable(minted.stored);
  if (notStored) return notStored;
  const url = followUpUrl(deps.settings.followUpBaseUrl, minted.reference);
  const noticeSent = recorded.noticeSent || (await notify({ report, link: { reference: minted.reference, url }, filingKey }, deps));
  const outcome = filingOutcome({ projectId: filing.projectId, kind: 'accepted', reason: null, at: filing.at });
  return { reportId: report.id, reference: minted.reference, followUpUrl: url, noticeSent, outcome };
}

async function fileNew(filing: Filing, recordUnder: string | null, deps: FileReportDeps): Promise<FilingReceipt | FilingRefusal> {
  const overQuota = await takeQuota(filing, deps.quota);
  return overQuota ?? file(filing, recordUnder, deps);
}

// --- exports ---

export async function fileReport(
  project: ProjectId,
  submission: ReportSubmission,
  assertion: Assertion | null,
  deps: FileReportDeps,
): Promise<FilingReceipt | FilingRefusal> {
  const filing = await admit(project, { submission, assertion }, deps);
  if (isRefusal(filing)) return filing;
  const recalled = await recall(filing, deps.projects);
  if (isRefusal(recalled)) return recalled;
  return isRepeat(recalled) ? repeat(filing, recalled, deps) : fileNew(filing, recalled.recordUnder, deps);
}
