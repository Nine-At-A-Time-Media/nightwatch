/**
 * markSpam -- a Member, or the Spam Judge through fileReport, marks a Report
 * as spam (design Behaviors: Spam is silent; Reports, Spam; Domain Language:
 * Spam Judge). In one IssueStore transaction the Report is flagged as spam,
 * and the Issue it is on is archived forever as spam when it holds no
 * Fingerprint and only spam Reports; a crash Issue a Report was moved onto
 * keeps its state. Archiving is the only effect: nothing is enqueued, the
 * Report Status its Reporter was shown stays, and no notice goes out.
 *
 * A SpamVerdict arrives already judged against the Spam Judge threshold by
 * fileReport; one that is not `spam` changes nothing. Ports: IssueStore,
 * Clock.
 */

import type { ReportId } from '../../domain/ids.js';
import { archive } from '../../domain/issue/commands.js';
import type { Actor, IssueChange, Member } from '../../domain/issue/state.js';
import { isRefusal } from '../../domain/refusal.js';
import { holdsOnlySpam } from '../../domain/report/report-issue.js';
import type { Report } from '../../domain/report/report.js';
import type { SpamVerdict } from '../../domain/report/spam.js';
import type { Clock } from '../../ports/clock.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type MarkSpamDeps = { issues: IssueStore; clock: Clock };

type Marking = { report: ReportId; actor: Actor; at: number };

// --- predicates ---

function isVerdict(actor: Member | SpamVerdict): actor is SpamVerdict {
  return 'verdict' in actor;
}

// --- helpers ---

function actorOf(actor: Member | SpamVerdict): Actor {
  return isVerdict(actor) ? 'spam_judge' : actor;
}

// --- flow ---

async function archiveIfSpamOnly(report: Report, marking: Marking, issues: IssueStore): Promise<IssueChange[]> {
  const state = await issues.getIssue(report.issueId);
  if (state === null) return [];
  const held = { reports: await issues.reportsOn(report.issueId), fingerprints: (await issues.fingerprintsOf(report.issueId)).length };
  if (!holdsOnlySpam(held)) return [];
  const archived = archive(state, { substatus: 'forever', spam: true }, marking.actor, marking.at);
  if (isRefusal(archived)) return [];
  await issues.putIssue(archived.state);
  await issues.appendHistory(archived.changes);
  return [...archived.changes];
}

async function markInTransaction(marking: Marking, issues: IssueStore): Promise<IssueChange[]> {
  const stored = await issues.getReport(marking.report);
  if (stored === null || stored.spam) return [];
  const report = { ...stored, spam: true };
  await issues.putReport(report);
  return archiveIfSpamOnly(report, marking, issues);
}

// --- exports ---

export async function markSpam(report: ReportId, actor: Member | SpamVerdict, deps: MarkSpamDeps): Promise<IssueChange[]> {
  if (isVerdict(actor) && actor.verdict !== 'spam') return [];
  const marking = { report, actor: actorOf(actor), at: deps.clock.now() };
  return deps.issues.transact(() => markInTransaction(marking, deps.issues));
}
