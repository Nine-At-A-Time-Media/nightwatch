/**
 * ProjectClient -- the seam for reaching one Project's state from another
 * runtime (architecture Seams: Reaching a Project's state from another
 * runtime; Use-case surface: every runtime but ProjectDO reaches a Project
 * only through this, which calls the ProjectDO use case). A Durable Object
 * stub in production; in tests and the local CLI, a direct call into an
 * in-process IssueStore.
 *
 * Writes call the ProjectDO use case or step of the same name; reads return
 * what the Project's IssueStore holds. Every call names the Project.
 */

import type { EventSummary } from '../domain/event/event-summary.js';
import type { Fingerprint } from '../domain/grouping/fingerprint.js';
import type { IssueId, ProjectId, ReportId } from '../domain/ids.js';
import type { Assignment } from '../domain/issue/assignment.js';
import type { IssueChange, IssueState, Member } from '../domain/issue/state.js';
import type { Refusal } from '../domain/refusal.js';
import type { Release, ReleaseFirstSeen } from '../domain/release/ordering.js';
import type { Report, Reporter } from '../domain/report/report.js';
import type { SpamVerdict } from '../domain/report/spam.js';
import type { Comment, ReporterComment, ReportStatusChange } from '../domain/report/thread.js';

export interface ProjectClient {
  // --- ProjectDO use cases and steps ---

  assignEvent(projectId: ProjectId, summary: EventSummary, fingerprints: Fingerprint[]): Promise<Assignment>;
  recordReleaseSeen(projectId: ProjectId, release: Release): Promise<IssueChange[]>;
  /** Opens the Report issue the new Report names and attaches the Report to it. */
  openReportIssue(projectId: ProjectId, report: Report): Promise<IssueChange[]>;
  markSpam(projectId: ProjectId, reportId: ReportId, actor: Member | SpamVerdict): Promise<IssueChange[]>;
  /** Saves a Reporter's reply on the Issue its Report is attached to. */
  recordReply(projectId: ProjectId, comment: ReporterComment): Promise<IssueChange[] | Refusal>;
  /** Records a change of the Report Status the Reporter is shown. */
  recordShownStatus(projectId: ProjectId, reportId: ReportId, change: ReportStatusChange): Promise<void>;

  // --- reads ---

  getReport(projectId: ProjectId, reportId: ReportId): Promise<Report | null>;
  reportsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]>;
  reportsBy(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]>;
  statusChangesOf(projectId: ProjectId, reportId: ReportId): Promise<readonly ReportStatusChange[]>;
  commentsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]>;
  getIssue(projectId: ProjectId, issueId: IssueId): Promise<IssueState | null>;
  releasesSeen(projectId: ProjectId): Promise<ReleaseFirstSeen>;
}
