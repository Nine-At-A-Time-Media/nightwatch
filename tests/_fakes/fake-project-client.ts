/**
 * FakeProjectClient -- the ProjectClient's second mechanism: a direct call
 * into an in-process IssueStore per Project (architecture Seams). Writes run
 * the ProjectDO use case or step of the same name against that Project's
 * FakeIssueStore; reads return what the store holds. `store(projectId)`
 * hands a test the store, to set a Given or inspect the result.
 */

import { addComment } from '../../src/application/reports/add-comment.js';
import { openReportIssue } from '../../src/application/reports/open-report-issue.js';
import { eraseReports } from '../../src/application/reports/erase-reports.js';
import { markSpam } from '../../src/application/reports/mark-spam.js';
import { moveReport } from '../../src/application/reports/move-report.js';
import { recordReply } from '../../src/application/reports/record-reply.js';
import { assignEvent } from '../../src/application/issues/assign-event.js';
import { assignIssue } from '../../src/application/issues/assign-issue.js';
import { recordReleaseSeen } from '../../src/application/issues/record-release-seen.js';
import type { AlertFiring } from '../../src/domain/alerts/alert-firing.js';
import type { Assignee } from '../../src/domain/alerts/issue-alert-rule.js';
import type { MetricAggregate } from '../../src/domain/alerts/metric-incident.js';
import type { Participation } from '../../src/domain/alerts/notification-settings.js';
import { addTrackerComment } from '../../src/application/tracker/add-tracker-comment.js';
import { recordCommitShipped } from '../../src/application/tracker/record-commit-shipped.js';
import { resolveByCommit } from '../../src/application/tracker/resolve-by-commit.js';
import { recordTrackerEvent } from '../../src/application/tracker/record-tracker-event.js';
import type { EventSummary } from '../../src/domain/event/event-summary.js';
import type { Fingerprint } from '../../src/domain/grouping/fingerprint.js';
import type { IssueId, ProjectId, ReportId } from '../../src/domain/ids.js';
import type { Assignment } from '../../src/domain/issue/assignment.js';
import type { IssuePolicies } from '../../src/domain/issue/policies.js';
import type { IssueChange, IssueState, Member } from '../../src/domain/issue/state.js';
import type { Refusal } from '../../src/domain/refusal.js';
import type { Release, ReleaseFirstSeen } from '../../src/domain/release/ordering.js';
import type { RecordedFiling } from '../../src/domain/report/filing.js';
import type { Report, Reporter } from '../../src/domain/report/report.js';
import type { SpamVerdict } from '../../src/domain/report/spam.js';
import type { Comment, MemberComment, ReporterComment, ReportStatusChange } from '../../src/domain/report/thread.js';
import type { ExternalLink } from '../../src/domain/tracker/external-link.js';
import type { TrackerEvent } from '../../src/domain/tracker/tracker-event.js';
import type { Clock } from '../../src/ports/clock.js';
import type { EffectQueue } from '../../src/ports/effect-queue.js';
import type { Ids } from '../../src/ports/ids.js';
import type { ProjectClient, SessionTotals } from '../../src/ports/project-client.js';
import { recordSession } from '../../src/application/releases/record-session.js';
import { openMonitorIssue } from '../../src/application/monitors/open-monitor-issue.js';
import { resolveMonitorIssue } from '../../src/application/monitors/resolve-monitor-issue.js';
import type { Environment, Session } from '../../src/domain/release/health.js';
import { FakeIssueStore } from './issue-store.js';

export type ProjectSide = { clock: Clock; ids: Ids; effects: EffectQueue; policies: IssuePolicies; dedupWindow: number };

export class FakeProjectClient implements ProjectClient {
  readonly #side: ProjectSide;
  readonly #stores = new Map<ProjectId, FakeIssueStore>();

  /** `side` is what the ProjectDO composition root would hand its use cases. */
  constructor(side: ProjectSide) {
    this.#side = side;
  }

  /** The Project's store, created empty on first use. */
  store(projectId: ProjectId): FakeIssueStore {
    const existing = this.#stores.get(projectId);
    if (existing) return existing;
    const created = new FakeIssueStore({ dedupWindow: this.#side.dedupWindow });
    this.#stores.set(projectId, created);
    return created;
  }

  async assignEvent(projectId: ProjectId, summary: EventSummary, fingerprints: Fingerprint[]): Promise<Assignment> {
    const { clock, ids, policies } = this.#side;
    return assignEvent(summary, fingerprints, { issues: this.store(projectId), clock, ids, policies });
  }

  async recordReleaseSeen(projectId: ProjectId, release: Release): Promise<IssueChange[]> {
    const { clock, effects } = this.#side;
    return recordReleaseSeen(release, { issues: this.store(projectId), effects, clock });
  }

  async openReportIssue(projectId: ProjectId, report: Report): Promise<IssueChange[]> {
    return openReportIssue(report, { issues: this.store(projectId) });
  }

  async markSpam(projectId: ProjectId, reportId: ReportId, actor: Member | SpamVerdict): Promise<IssueChange[]> {
    return markSpam(reportId, actor, { issues: this.store(projectId), clock: this.#side.clock });
  }

  async recordReply(projectId: ProjectId, comment: ReporterComment): Promise<IssueChange[] | Refusal> {
    return recordReply(comment, { issues: this.store(projectId) });
  }

  async eraseReports(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return eraseReports(reporter, { issues: this.store(projectId) });
  }

  async recordShownStatus(projectId: ProjectId, reportId: ReportId, change: ReportStatusChange): Promise<void> {
    const store = this.store(projectId);
    await store.transact(() => store.recordStatusChange(reportId, change));
  }

  async getReport(projectId: ProjectId, reportId: ReportId): Promise<Report | null> {
    return this.store(projectId).getReport(reportId);
  }

  async reportsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]> {
    return this.store(projectId).reportsOn(issueId);
  }

  async reportsBy(projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
    return this.store(projectId).reportsBy(reporter);
  }

  async statusChangesOf(projectId: ProjectId, reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return this.store(projectId).statusChangesOf(reportId);
  }

  async commentsOn(projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]> {
    return this.store(projectId).commentsOn(issueId);
  }

  async getIssue(projectId: ProjectId, issueId: IssueId): Promise<IssueState | null> {
    return this.store(projectId).getIssue(issueId);
  }

  async releasesSeen(projectId: ProjectId): Promise<ReleaseFirstSeen> {
    return this.store(projectId).releaseFirstSeen();
  }

  // --- task-022: Sessions for Release Health ---

  async recordSession(projectId: ProjectId, session: Session): Promise<void> {
    return recordSession(session, { issues: this.store(projectId) });
  }

  async sessionTotals(projectId: ProjectId, scope: { release: Release; environment: Environment }): Promise<SessionTotals> {
    const store = this.store(projectId);
    return { sessions: await store.sessionCounts(scope), users: await store.sessionUsers(scope) };
  }

  // --- task-022: monitor issues ---

  async openMonitorIssue(projectId: ProjectId, opening: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return openMonitorIssue(opening, { issues: this.store(projectId), effects: this.#side.effects });
  }

  async resolveMonitorIssue(projectId: ProjectId, resolving: { issueId: IssueId; at: number }): Promise<IssueChange[]> {
    return resolveMonitorIssue(resolving, { issues: this.store(projectId), effects: this.#side.effects });
  }

  // --- task-021: alert evaluation, firings, follow participations and replies by email ---

  async countEvents(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return this.store(projectId).countEvents(range);
  }

  async countUsers(projectId: ProjectId, range: { issueId: IssueId; since: number }): Promise<number> {
    return this.store(projectId).countUsers(range);
  }

  async fingerprintsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Fingerprint[]> {
    return this.store(projectId).fingerprintsOf(issueId);
  }

  async assigneeOf(projectId: ProjectId, issueId: IssueId): Promise<Assignee | null> {
    return this.store(projectId).assigneeOf(issueId);
  }

  async lastFiring(projectId: ProjectId, key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null> {
    return this.store(projectId).lastFiring(key);
  }

  async recordFiring(projectId: ProjectId, firing: AlertFiring): Promise<void> {
    const store = this.store(projectId);
    await store.transact(() => store.recordFiring(firing));
  }

  async firingsOf(projectId: ProjectId, ruleId: string): Promise<readonly AlertFiring[]> {
    return this.store(projectId).firingsOf(ruleId);
  }

  async participationsOf(projectId: ProjectId, issueId: IssueId): Promise<readonly Participation[]> {
    return this.store(projectId).participationsOf(issueId);
  }

  async addComment(
    projectId: ProjectId,
    issueId: IssueId,
    comment: Pick<MemberComment, 'text' | 'shared'>,
    actor: Member,
  ): Promise<IssueChange[]> {
    const { clock, ids, effects } = this.#side;
    return addComment(issueId, comment, actor, { issues: this.store(projectId), effects, clock, ids });
  }

  /** Event and user counts over every Issue's Events; a crash-free rate needs Sessions, which the store does not hold. */
  async metricValue(projectId: ProjectId, query: { aggregate: MetricAggregate; since: number }): Promise<number | null> {
    if (query.aggregate === 'crash_free_rate') return null;
    const store = this.store(projectId);
    const issues = await store.listIssues();
    const events = (await Promise.all(issues.map((issue) => store.eventsOf(issue.issueId))))
      .flat()
      .filter((event) => event.summary.at >= query.since);
    if (query.aggregate === 'event_count') return events.length;
    return new Set(events.flatMap((event) => (event.summary.userKey === null ? [] : [event.summary.userKey]))).size;
  }

  // --- task-011: Code and GitHub ---

  async externalLinkOf(projectId: ProjectId, issueId: IssueId): Promise<ExternalLink | null> {
    return this.store(projectId).externalLinkOf(issueId);
  }

  async recordExternalLink(projectId: ProjectId, externalLink: ExternalLink): Promise<void> {
    const store = this.store(projectId);
    await store.transact(() => store.putExternalLink(externalLink));
  }

  async latestEventOf(projectId: ProjectId, issueId: IssueId): Promise<EventSummary | null> {
    const events = await this.store(projectId).eventsOf(issueId);
    return events
      .map((event) => event.summary)
      .reduce<EventSummary | null>((latest, event) => (latest && latest.at > event.at ? latest : event), null);
  }

  async recordTrackerEvent(
    projectId: ProjectId,
    tracked: { issueId: IssueId; event: TrackerEvent; appActor: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    const { issueId, ...rest } = tracked;
    return recordTrackerEvent(issueId, rest, { issues: this.store(projectId), effects: this.#side.effects });
  }

  async addTrackerComment(
    projectId: ProjectId,
    comment: { issueId: IssueId; author: Member; text: string; at: number },
  ): Promise<IssueChange[] | Refusal> {
    const { issueId, ...rest } = comment;
    return addTrackerComment(issueId, rest, { issues: this.store(projectId), effects: this.#side.effects, ids: this.#side.ids });
  }

  async resolveByCommit(projectId: ProjectId, fix: { shortId: number; commit: string; at: number }): Promise<IssueChange[] | Refusal> {
    return resolveByCommit(fix, { issues: this.store(projectId), effects: this.#side.effects });
  }

  async recordCommitShipped(projectId: ProjectId, shipped: { commit: string; release: Release; at: number }): Promise<IssueChange[]> {
    return recordCommitShipped(shipped, { issues: this.store(projectId), effects: this.#side.effects });
  }

  // --- task-025: filings recorded under a filing key ---

  async recallFiling(projectId: ProjectId, filingKey: string): Promise<RecordedFiling | null> {
    return this.store(projectId).recallFiling(filingKey);
  }

  async recordFiling(projectId: ProjectId, filingKey: string, filing: RecordedFiling): Promise<void> {
    const store = this.store(projectId);
    await store.transact(() => store.recordFiling(filingKey, filing));
  }
  // --- task-027: assignment and Report moves ---

  async assignIssue(
    projectId: ProjectId,
    issueId: IssueId,
    assignee: Assignee | null,
    actor: Member | 'system',
  ): Promise<IssueChange[] | Refusal> {
    const { clock, effects } = this.#side;
    return assignIssue(issueId, assignee, actor, { issues: this.store(projectId), effects, clock });
  }

  async moveReport(projectId: ProjectId, move: { reportId: ReportId; to: IssueId; actor: Member }): Promise<Report | Refusal> {
    return moveReport(move.reportId, move.to, move.actor, { issues: this.store(projectId) });
  }
}
