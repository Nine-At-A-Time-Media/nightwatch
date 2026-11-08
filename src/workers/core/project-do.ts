/**
 * ProjectDO -- the Durable Object holding one Project's issue state, its id
 * derived from the Project id (architecture Mechanism: Issues). Its
 * constructor is the composition root that builds the runtime once (deps.ts);
 * its RPC methods are exactly the ProjectClient operations, each taking plain
 * values and forwarding to one module function (project-steps.ts), and its
 * alarm runs the sweep. The class adds no step of its own that a bound Worker
 * could reach over RPC.
 */

import type { SearchContext } from '../../domain/search/match.js';
import type { IssuePage, SearchPlan } from '../../domain/search/page.js';
import { DurableObject } from 'cloudflare:workers';
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
import { projectRuntime, type ProjectRuntime } from './deps.js';
import * as steps from './project-steps.js';

export class ProjectDO extends DurableObject<CoreEnv> implements ProjectClient {
  readonly #runtime: ProjectRuntime;

  constructor(ctx: DurableObjectState, env: CoreEnv) {
    super(ctx, env);
    this.#runtime = projectRuntime({ storage: ctx.storage, env });
  }

  override async alarm(): Promise<void> {
    await steps.sweepStep(this.#runtime);
  }

  // --- ProjectDO use cases and steps ---

  assignEvent(projectId: ProjectId, summary: EventSummary, fingerprints: Fingerprint[]): Promise<Assignment> {
    return steps.assignEventStep(this.#runtime, projectId, summary, fingerprints);
  }

  recordReleaseSeen(projectId: ProjectId, release: Release): Promise<IssueChange[]> {
    return steps.recordReleaseSeenStep(this.#runtime, projectId, release);
  }

  openReportIssue(projectId: ProjectId, report: Report): Promise<IssueChange[]> {
    return steps.openReportIssueStep(this.#runtime, projectId, report);
  }

  markSpam(projectId: ProjectId, reportId: ReportId, actor: Member | SpamVerdict): Promise<IssueChange[]> {
    return steps.markSpamStep(this.#runtime, projectId, reportId, actor);
  }

  recordReply(projectId: ProjectId, comment: ReporterComment): Promise<IssueChange[] | Refusal> {
    return steps.recordReplyStep(this.#runtime, projectId, comment);
  }

  eraseReports(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return steps.eraseReportsStep(this.#runtime, projectId, reporter);
  }

  recordShownStatus(projectId: ProjectId, reportId: ReportId, change: ReportStatusChange): Promise<void> {
    return steps.recordShownStatusStep(this.#runtime, projectId, reportId, change);
  }

  // --- reads ---

  getReport(projectId: ProjectId, reportId: ReportId): Promise<Report | null> {
    return steps.getReportStep(this.#runtime, projectId, reportId);
  }

  reportsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]> {
    return steps.reportsOnStep(this.#runtime, projectId, issueId);
  }

  reportsBy(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return steps.reportsByStep(this.#runtime, projectId, reporter);
  }

  statusChangesOf(projectId: ProjectId, reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return steps.statusChangesOfStep(this.#runtime, projectId, reportId);
  }

  commentsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]> {
    return steps.commentsOnStep(this.#runtime, projectId, issueId);
  }

  getIssue(projectId: ProjectId, issueId: IssueId): Promise<IssueState | null> {
    return steps.getIssueStep(this.#runtime, projectId, issueId);
  }

  releasesSeen(projectId: ProjectId): Promise<ReleaseFirstSeen> {
    return steps.releasesSeenStep(this.#runtime, projectId);
  }

  // --- task-022: Sessions and monitor issues ---

  recordSession(projectId: ProjectId, session: Session): Promise<void> {
    return steps.recordSessionStep(this.#runtime, projectId, session);
  }

  sessionTotals(projectId: ProjectId, scope: { release: Release; environment: Environment }): Promise<SessionTotals> {
    return steps.sessionTotalsStep(this.#runtime, projectId, scope);
  }

  openMonitorIssue(projectId: ProjectId, opening: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return steps.openMonitorIssueStep(this.#runtime, projectId, opening);
  }

  resolveMonitorIssue(projectId: ProjectId, resolving: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return steps.resolveMonitorIssueStep(this.#runtime, projectId, resolving);
  }

  // --- task-021: alert evaluation, firings, participations and comments ---

  countEvents(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return steps.countEventsStep(this.#runtime, projectId, range);
  }

  countUsers(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return steps.countUsersStep(this.#runtime, projectId, range);
  }

  fingerprintsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Fingerprint[]> {
    return steps.fingerprintsOfStep(this.#runtime, projectId, issueId);
  }

  assigneeOf(projectId: ProjectId, issueId: IssueId): Promise<Assignee | null> {
    return steps.assigneeOfStep(this.#runtime, projectId, issueId);
  }

  lastFiring(projectId: ProjectId, key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null> {
    return steps.lastFiringStep(this.#runtime, projectId, key);
  }

  recordFiring(projectId: ProjectId, firing: AlertFiring): Promise<void> {
    return steps.recordFiringStep(this.#runtime, projectId, firing);
  }

  firingsOf(projectId: ProjectId, ruleId: string): Promise<readonly AlertFiring[]> {
    return steps.firingsOfStep(this.#runtime, projectId, ruleId);
  }

  participationsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Participation[]> {
    return steps.participationsOfStep(this.#runtime, projectId, issueId);
  }

  addComment(
    projectId: ProjectId,
    issueId: IssueId,
    comment: Pick<MemberComment, 'text' | 'shared'>,
    actor: Member,
  ): Promise<IssueChange[]> {
    return steps.addCommentStep(this.#runtime, projectId, { issueId, draft: comment, actor });
  }

  metricValue(projectId: ProjectId, query: { aggregate: MetricAggregate; since: number }): Promise<number | null> {
    return steps.metricValueStep(this.#runtime, projectId, query);
  }

  // --- task-011: Code and GitHub ---

  externalLinkOf(projectId: ProjectId, issueId: IssueId): Promise<ExternalLink | null> {
    return steps.externalLinkOfStep(this.#runtime, projectId, issueId);
  }

  recordExternalLink(projectId: ProjectId, externalLink: ExternalLink): Promise<void> {
    return steps.recordExternalLinkStep(this.#runtime, projectId, externalLink);
  }

  latestEventOf(projectId: ProjectId, issueId: IssueId): Promise<EventSummary | null> {
    return steps.latestEventOfStep(this.#runtime, projectId, issueId);
  }

  recordTrackerEvent(
    projectId: ProjectId,
    tracked: { issueId: IssueId; event: TrackerEvent; appActor: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    return steps.recordTrackerEventStep(this.#runtime, projectId, tracked);
  }

  addTrackerComment(
    projectId: ProjectId,
    comment: { issueId: IssueId; author: Member; text: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    return steps.addTrackerCommentStep(this.#runtime, projectId, comment);
  }

  resolveByCommit(projectId: ProjectId, fix: { shortId: number; commit: string; at: number }): Promise<IssueChange[] | Refusal> {
    return steps.resolveByCommitStep(this.#runtime, projectId, fix);
  }

  recordCommitShipped(projectId: ProjectId, shipped: { commit: string; release: Release; at: number }): Promise<IssueChange[]> {
    return steps.recordCommitShippedStep(this.#runtime, projectId, shipped);
  }

  // --- task-025: filings recorded under a filing key ---

  recallFiling(projectId: ProjectId, filingKey: string): Promise<RecordedFiling | null> {
    return steps.recallFilingStep(this.#runtime, projectId, filingKey);
  }

  recordFiling(projectId: ProjectId, filingKey: string, filing: RecordedFiling): Promise<void> {
    return steps.recordFilingStep(this.#runtime, projectId, { filingKey, filing });
  }

  searchPage(projectId: ProjectId, plan: SearchPlan, context: SearchContext, slug: string): Promise<IssuePage> {
    return steps.searchPageStep(this.#runtime, projectId, { plan, context, slug });
  }

  // --- task-027: assignment and Report moves ---

  assignIssue(
    projectId: ProjectId,
    issueId: IssueId,
    assignee: Assignee | null,
    actor: Member | 'system',
  ): Promise<IssueChange[] | Refusal> {
    return steps.assignIssueStep(this.#runtime, projectId, { issueId, assignee, actor });
  }

  moveReport(projectId: ProjectId, move: { reportId: ReportId; to: IssueId; actor: Member }): Promise<Report | Refusal> {
    return steps.moveReportStep(this.#runtime, projectId, move);
  }
  // --- task-034: retention from the scheduler ---
  enforceRetention(projectId: ProjectId, retention: RetentionPolicy): Promise<Expiry> {
    return steps.enforceRetentionStep(this.#runtime, projectId, retention);
  }

  // --- task-038: triage, merge, split, discard ---

  triageIssue(projectId: ProjectId, issueId: IssueId, action: TriageAction, actor: Member): Promise<IssueChange[] | Refusal> {
    return steps.triageIssueStep(this.#runtime, projectId, { issueId, action, actor });
  }

  mergeIssues(projectId: ProjectId, merge: { target: IssueId; sources: IssueId[]; actor: Member }): Promise<IssueChange[] | Refusal> {
    return steps.mergeIssuesStep(this.#runtime, projectId, merge);
  }

  splitIssue(
    projectId: ProjectId,
    split: { issueId: IssueId; fingerprints: Fingerprint[]; actor: Member },
  ): Promise<IssueChange[] | Refusal> {
    return steps.splitIssueStep(this.#runtime, projectId, split);
  }

  discardIssue(projectId: ProjectId, issueId: IssueId, actor: Member): Promise<IssueChange[] | Refusal> {
    return steps.discardIssueStep(this.#runtime, projectId, { issueId, actor });
  }

  shortIdOf(projectId: ProjectId, issueId: IssueId): Promise<number | null> {
    return steps.shortIdOfStep(this.#runtime, projectId, issueId);
  }
}
