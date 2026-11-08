/**
 * eraseReports -- the ProjectDO step of an erasure (design Retention and data
 * handling, Erasure). No design row of its own: eraseReporter reaches it
 * through ProjectClient. In one IssueStore transaction every Report the
 * Reporter filed in this Project is removed with the replies written on it
 * and the Report Status changes it showed; a Report issue left with neither
 * a Report nor a Fingerprint is removed too. History holds no address, so it
 * is left as it is. Returns the Reports removed, so the caller can delete
 * their Attachments. Ports: IssueStore.
 */

import type { IssueId } from '../../domain/ids.js';
import { isEmptyReportIssue } from '../../domain/report/report-issue.js';
import type { Report, Reporter } from '../../domain/report/report.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type EraseReportsDeps = { issues: IssueStore };

// --- flow ---

async function removeIfEmpty(issueId: IssueId, issues: IssueStore): Promise<void> {
  const held = { reports: (await issues.reportsOn(issueId)).length, fingerprints: (await issues.fingerprintsOf(issueId)).length };
  if (isEmptyReportIssue(held)) await issues.removeIssue(issueId);
}

async function eraseInTransaction(reporter: Reporter, issues: IssueStore): Promise<Report[]> {
  const reports = [...(await issues.reportsBy(reporter))];
  for (const report of reports) await issues.removeReport(report.id);
  for (const issueId of new Set(reports.map((report) => report.issueId))) await removeIfEmpty(issueId, issues);
  return reports;
}

// --- exports ---

export async function eraseReports(reporter: Reporter, deps: EraseReportsDeps): Promise<Report[]> {
  return deps.issues.transact(() => eraseInTransaction(reporter, deps.issues));
}
