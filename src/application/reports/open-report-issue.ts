/**
 * openReportIssue -- the ProjectDO step that attaches a newly filed Report
 * (design Reports, Attachment: a new Report starts on its own Report issue).
 * No design row of its own: fileReport reaches it through ProjectClient. In
 * one IssueStore transaction it opens the Report issue the Report names,
 * gives it a Short Id, stores the Report, and records Received as the first
 * Report Status the Reporter is shown. Returns the Issue Changes for the
 * caller to enqueue. Ports: IssueStore.
 */

import type { IssueChange } from '../../domain/issue/state.js';
import type { Report } from '../../domain/report/report.js';
import { createReportIssue } from '../../domain/report/report-issue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type OpenReportIssueDeps = { issues: IssueStore };

// --- flow ---

async function openInTransaction(report: Report, issues: IssueStore): Promise<IssueChange[]> {
  const opened = createReportIssue({ issueId: report.issueId, at: report.filedAt });
  await issues.assignShortId(report.issueId);
  await issues.putIssue(opened.state);
  await issues.appendHistory(opened.changes);
  await issues.putReport(report);
  await issues.recordStatusChange(report.id, { status: 'received', at: report.filedAt });
  return [...opened.changes];
}

// --- exports ---

export async function openReportIssue(report: Report, deps: OpenReportIssueDeps): Promise<IssueChange[]> {
  return deps.issues.transact(() => openInTransaction(report, deps.issues));
}
