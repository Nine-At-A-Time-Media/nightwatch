/**
 * DurableProjectClient -- the ProjectClient over the ProjectDO namespace
 * (architecture Seams: Reaching a Project's state from another runtime). A
 * Project's object is the one named by its Project id, so every call goes to
 * idFromName(projectId) and names the Project again, which the object checks
 * against the Project it holds.
 *
 * `lastProject` names the Project the most recent call went to. A request
 * that reaches one Project (filing a Report, a reporter's reply) uses it to
 * name that Project beside the Issue Changes the call returned, which do not
 * carry it (QueueEffectQueue).
 */

import type { SearchContext } from '../../domain/search/match.js';
import type { IssuePage, SearchPlan } from '../../domain/search/page.js';
import type { AlertFiring } from '../../domain/alerts/alert-firing.js';
import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import type { MetricAggregate } from '../../domain/alerts/metric-incident.js';
import type { Participation } from '../../domain/alerts/notification-settings.js';
import type { EventSummary } from '../../domain/event/event-summary.js';
import type { Fingerprint } from '../../domain/grouping/fingerprint.js';
import type { IssueId, ProjectId, ReportId } from '../../domain/ids.js';
import type { Assignment } from '../../domain/issue/assignment.js';
import type { IssueChange, IssueState, Member } from '../../domain/issue/state.js';
import type { TriageAction } from '../../domain/issue/triage.js';
import type { Refusal } from '../../domain/refusal.js';
import type { Expiry, RetentionPolicy } from '../../domain/retention/retention.js';
import type { Environment, Session } from '../../domain/release/health.js';
import type { Release, ReleaseFirstSeen } from '../../domain/release/ordering.js';
import type { RecordedFiling } from '../../domain/report/filing.js';
import type { Report, Reporter } from '../../domain/report/report.js';
import type { SpamVerdict } from '../../domain/report/spam.js';
import type { Comment, MemberComment, ReporterComment, ReportStatusChange } from '../../domain/report/thread.js';
import type { ExternalLink } from '../../domain/tracker/external-link.js';
import type { TrackerEvent } from '../../domain/tracker/tracker-event.js';
import type { ProjectClient, SessionTotals } from '../../ports/project-client.js';

/** The ProjectDO namespace as this client uses it; a Durable Object namespace binding of ProjectDO satisfies it. */
export interface ProjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): ProjectClient;
}

export class DurableProjectClient implements ProjectClient {
  readonly #namespace: ProjectNamespace;

  constructor({ namespace }: { namespace: ProjectNamespace }) {
    this.#namespace = namespace;
  }

  #lastProject: ProjectId | null = null;

  /** The Project the most recent call went to; null before any call. */
  lastProject(): ProjectId | null {
    return this.#lastProject;
  }

  #project(projectId: ProjectId): ProjectClient {
    this.#lastProject = projectId;
    return this.#namespace.get(this.#namespace.idFromName(projectId));
  }

  assignEvent(projectId: ProjectId, summary: EventSummary, fingerprints: Fingerprint[]): Promise<Assignment> {
    return this.#project(projectId).assignEvent(projectId, summary, fingerprints);
  }

  recordReleaseSeen(projectId: ProjectId, release: Release): Promise<IssueChange[]> {
    return this.#project(projectId).recordReleaseSeen(projectId, release);
  }

  openReportIssue(projectId: ProjectId, report: Report): Promise<IssueChange[]> {
    return this.#project(projectId).openReportIssue(projectId, report);
  }

  markSpam(projectId: ProjectId, reportId: ReportId, actor: Member | SpamVerdict): Promise<IssueChange[]> {
    return this.#project(projectId).markSpam(projectId, reportId, actor);
  }

  recordReply(projectId: ProjectId, comment: ReporterComment): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).recordReply(projectId, comment);
  }

  eraseReports(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return this.#project(projectId).eraseReports(projectId, reporter);
  }

  recordShownStatus(projectId: ProjectId, reportId: ReportId, change: ReportStatusChange): Promise<void> {
    return this.#project(projectId).recordShownStatus(projectId, reportId, change);
  }

  getReport(projectId: ProjectId, reportId: ReportId): Promise<Report | null> {
    return this.#project(projectId).getReport(projectId, reportId);
  }

  reportsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]> {
    return this.#project(projectId).reportsOn(projectId, issueId);
  }

  reportsBy(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return this.#project(projectId).reportsBy(projectId, reporter);
  }

  statusChangesOf(projectId: ProjectId, reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return this.#project(projectId).statusChangesOf(projectId, reportId);
  }

  commentsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]> {
    return this.#project(projectId).commentsOn(projectId, issueId);
  }

  getIssue(projectId: ProjectId, issueId: IssueId): Promise<IssueState | null> {
    return this.#project(projectId).getIssue(projectId, issueId);
  }

  releasesSeen(projectId: ProjectId): Promise<ReleaseFirstSeen> {
    return this.#project(projectId).releasesSeen(projectId);
  }

  recordSession(projectId: ProjectId, session: Session): Promise<void> {
    return this.#project(projectId).recordSession(projectId, session);
  }

  sessionTotals(projectId: ProjectId, scope: { release: Release; environment: Environment }): Promise<SessionTotals> {
    return this.#project(projectId).sessionTotals(projectId, scope);
  }

  openMonitorIssue(projectId: ProjectId, opening: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return this.#project(projectId).openMonitorIssue(projectId, opening);
  }

  resolveMonitorIssue(projectId: ProjectId, resolving: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return this.#project(projectId).resolveMonitorIssue(projectId, resolving);
  }

  countEvents(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return this.#project(projectId).countEvents(projectId, range);
  }

  countUsers(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return this.#project(projectId).countUsers(projectId, range);
  }

  fingerprintsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Fingerprint[]> {
    return this.#project(projectId).fingerprintsOf(projectId, issueId);
  }

  assigneeOf(projectId: ProjectId, issueId: IssueId): Promise<Assignee | null> {
    return this.#project(projectId).assigneeOf(projectId, issueId);
  }

  lastFiring(projectId: ProjectId, key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null> {
    return this.#project(projectId).lastFiring(projectId, key);
  }

  recordFiring(projectId: ProjectId, firing: AlertFiring): Promise<void> {
    return this.#project(projectId).recordFiring(projectId, firing);
  }

  firingsOf(projectId: ProjectId, ruleId: string): Promise<readonly AlertFiring[]> {
    return this.#project(projectId).firingsOf(projectId, ruleId);
  }

  participationsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Participation[]> {
    return this.#project(projectId).participationsOf(projectId, issueId);
  }

  addComment(
    projectId: ProjectId,
    issueId: IssueId,
    comment: Pick<MemberComment, 'text' | 'shared'>,
    actor: Member,
  ): Promise<IssueChange[]> {
    return this.#project(projectId).addComment(projectId, issueId, comment, actor);
  }

  metricValue(projectId: ProjectId, query: { aggregate: MetricAggregate; since: number }): Promise<number | null> {
    return this.#project(projectId).metricValue(projectId, query);
  }

  externalLinkOf(projectId: ProjectId, issueId: IssueId): Promise<ExternalLink | null> {
    return this.#project(projectId).externalLinkOf(projectId, issueId);
  }

  recordExternalLink(projectId: ProjectId, externalLink: ExternalLink): Promise<void> {
    return this.#project(projectId).recordExternalLink(projectId, externalLink);
  }

  latestEventOf(projectId: ProjectId, issueId: IssueId): Promise<EventSummary | null> {
    return this.#project(projectId).latestEventOf(projectId, issueId);
  }

  recordTrackerEvent(
    projectId: ProjectId,
    tracked: { issueId: IssueId; event: TrackerEvent; appActor: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).recordTrackerEvent(projectId, tracked);
  }

  addTrackerComment(
    projectId: ProjectId,
    comment: { issueId: IssueId; author: Member; text: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).addTrackerComment(projectId, comment);
  }

  resolveByCommit(projectId: ProjectId, fix: { shortId: number; commit: string; at: number }): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).resolveByCommit(projectId, fix);
  }

  recordCommitShipped(projectId: ProjectId, shipped: { commit: string; release: Release; at: number }): Promise<IssueChange[]> {
    return this.#project(projectId).recordCommitShipped(projectId, shipped);
  }

  recallFiling(projectId: ProjectId, filingKey: string): Promise<RecordedFiling | null> {
    return this.#project(projectId).recallFiling(projectId, filingKey);
  }

  recordFiling(projectId: ProjectId, filingKey: string, filing: RecordedFiling): Promise<void> {
    return this.#project(projectId).recordFiling(projectId, filingKey, filing);
  }

  searchPage(projectId: ProjectId, plan: SearchPlan, context: SearchContext, slug: string): Promise<IssuePage> {
    return this.#project(projectId).searchPage(projectId, plan, context, slug);
  }

  // --- task-027: assignment and Report moves ---

  assignIssue(
    projectId: ProjectId,
    issueId: IssueId,
    assignee: Assignee | null,
    actor: Member | 'system',
  ): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).assignIssue(projectId, issueId, assignee, actor);
  }

  moveReport(projectId: ProjectId, move: { reportId: ReportId; to: IssueId; actor: Member }): Promise<Report | Refusal> {
    return this.#project(projectId).moveReport(projectId, move);
  }

  // --- task-034: retention from the scheduler ---

  enforceRetention(projectId: ProjectId, retention: RetentionPolicy): Promise<Expiry> {
    return this.#project(projectId).enforceRetention(projectId, retention);
  }

  // --- task-038: triage, merge, split, discard ---

  triageIssue(projectId: ProjectId, issueId: IssueId, action: TriageAction, actor: Member): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).triageIssue(projectId, issueId, action, actor);
  }

  mergeIssues(projectId: ProjectId, merge: { target: IssueId; sources: IssueId[]; actor: Member }): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).mergeIssues(projectId, merge);
  }

  splitIssue(
    projectId: ProjectId,
    split: { issueId: IssueId; fingerprints: Fingerprint[]; actor: Member },
  ): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).splitIssue(projectId, split);
  }

  discardIssue(projectId: ProjectId, issueId: IssueId, actor: Member): Promise<IssueChange[] | Refusal> {
    return this.#project(projectId).discardIssue(projectId, issueId, actor);
  }

  shortIdOf(projectId: ProjectId, issueId: IssueId): Promise<number | null> {
    return this.#project(projectId).shortIdOf(projectId, issueId);
  }
}
