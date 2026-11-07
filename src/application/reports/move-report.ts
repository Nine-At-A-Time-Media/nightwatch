/**
 * moveReport -- a Member moves a Report to another Issue (design Reports,
 * Duplicates: a team member can move a Report to another issue; all Reports
 * on an issue share that issue's outcome). No design row of its own; the
 * nearest is Duplicate reports share outcome, whose Given it sets.
 *
 * In one IssueStore transaction the Report is attached to the target Issue,
 * and the replies its Reporter wrote on it move there with it, so its Thread
 * stays whole and its Report Status is derived from the target Issue from
 * then on. The Issue it leaves keeps its own History and state. A target the
 * Project does not hold, or one going away, is refused. Nothing is enqueued:
 * no Issue changed state, and the Reporter hears of the new Issue's outcome
 * at its next change. Ports: IssueStore.
 */

import type { IssueId, ReportId } from '../../domain/ids.js';
import { goneRefusal, issueNotFound, type Member } from '../../domain/issue/state.js';
import { refusal, type Refusal } from '../../domain/refusal.js';
import type { Report } from '../../domain/report/report.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type MoveReportDeps = { issues: IssueStore };

// --- flow ---

async function moveInTransaction(move: { reportId: ReportId; to: IssueId }, issues: IssueStore): Promise<Report | Refusal> {
  const report = await issues.getReport(move.reportId);
  if (report === null) return refusal('not-found');
  if (report.issueId === move.to) return report;
  const target = await issues.getIssue(move.to);
  if (target === null) return issueNotFound();
  const gone = goneRefusal(target);
  if (gone) return gone;
  await issues.moveReport(move);
  return { ...report, issueId: move.to };
}

// --- exports ---

/** `actor` is the Member moving it; the console checks their permission before calling. */
export async function moveReport(report: ReportId, toIssue: IssueId, actor: Member, deps: MoveReportDeps): Promise<Report | Refusal> {
  return deps.issues.transact(() => moveInTransaction({ reportId: report, to: toIssue }, deps.issues));
}
