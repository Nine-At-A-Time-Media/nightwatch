/**
 * The ProjectDO steps -- one module function per ProjectClient operation,
 * plus the sweep alarm. ProjectDO only forwards to these, so no step is a
 * method a bound Worker could call by another name (cloudflare-hosting:
 * every step past authorization is a module function). Each step first
 * claims the object for the Project the call names, then builds the use
 * case's deps from the object's runtime and calls the use case; reads return
 * what the IssueStore holds, as the fake ProjectClient does.
 */

import { claimedProject, claimProject, scheduleSweep } from '../../adapters/do-sqlite/project-identity.js';
import { assignEvent } from '../../application/issues/assign-event.js';
import { recordReleaseSeen } from '../../application/issues/record-release-seen.js';
import { sweepIssues } from '../../application/issues/sweep-issues.js';
import { openMonitorIssue } from '../../application/monitors/open-monitor-issue.js';
import { resolveMonitorIssue } from '../../application/monitors/resolve-monitor-issue.js';
import { recordSession } from '../../application/releases/record-session.js';
import { addComment, type CommentDraft } from '../../application/reports/add-comment.js';
import { eraseReports } from '../../application/reports/erase-reports.js';
import { markSpam } from '../../application/reports/mark-spam.js';
import { openReportIssue } from '../../application/reports/open-report-issue.js';
import { recordReply } from '../../application/reports/record-reply.js';
import { addTrackerComment } from '../../application/tracker/add-tracker-comment.js';
import { recordCommitShipped } from '../../application/tracker/record-commit-shipped.js';
import { recordTrackerEvent } from '../../application/tracker/record-tracker-event.js';
import { resolveByCommit } from '../../application/tracker/resolve-by-commit.js';
import type { AlertFiring } from '../../domain/alerts/alert-firing.js';
import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import type { MetricAggregate } from '../../domain/alerts/metric-incident.js';
import type { Participation } from '../../domain/alerts/notification-settings.js';
import type { EventSummary } from '../../domain/event/event-summary.js';
import type { Fingerprint } from '../../domain/grouping/fingerprint.js';
import type { IssueId, ProjectId, ReportId } from '../../domain/ids.js';
import type { Assignment } from '../../domain/issue/assignment.js';
import type { IssueChange, IssueState, Member } from '../../domain/issue/state.js';
import type { GroupedEvent } from '../../domain/issue/tally.js';
import type { Refusal } from '../../domain/refusal.js';
import type { Environment, Session } from '../../domain/release/health.js';
import type { Release, ReleaseFirstSeen } from '../../domain/release/ordering.js';
import type { RecordedFiling } from '../../domain/report/filing.js';
import type { Report, Reporter } from '../../domain/report/report.js';
import type { SpamVerdict } from '../../domain/report/spam.js';
import type { Comment, ReporterComment, ReportStatusChange } from '../../domain/report/thread.js';
import type { ExternalLink } from '../../domain/tracker/external-link.js';
import type { TrackerEvent } from '../../domain/tracker/tracker-event.js';
import type { SessionTotals } from '../../ports/project-client.js';
import type { ProjectRuntime } from './deps.js';

type Range = { issueId: IssueId; since: number };
type Scope = { release: Release; environment: Environment };

// --- helpers ---

/** The most recent Event Summary; of two at the same time, the later recorded. */
export function latestSummary(events: readonly GroupedEvent[]): EventSummary | null {
  return events
    .map((event) => event.summary)
    .reduce<EventSummary | null>((latest, summary) => (latest && latest.at > summary.at ? latest : summary), null);
}

/** Event and user counts over the Events at or after `since`; a crash-free rate needs Sessions the Events do not carry. */
export function metricOf({ aggregate, events, since }: { aggregate: MetricAggregate; events: readonly GroupedEvent[]; since: number }) {
  if (aggregate === 'crash_free_rate') return null;
  const counted = events.filter((event) => event.summary.at >= since);
  if (aggregate === 'event_count') return counted.length;
  return new Set(counted.flatMap((event) => (event.summary.userKey === null ? [] : [event.summary.userKey]))).size;
}

// --- flow: the object and its sweep ---

/** Claims the object for the Project; the first claim sets the first sweep. */
async function claim(runtime: ProjectRuntime, projectId: ProjectId): Promise<void> {
  if (claimProject(runtime.storage.sql, projectId)) await scheduleSweep(runtime.storage, runtime.clock.now() + runtime.sweepInterval);
}

/** The alarm: sweeps the Project's Issues, then sets the next sweep. */
export async function sweepStep(runtime: ProjectRuntime): Promise<void> {
  const projectId = claimedProject(runtime.storage.sql);
  if (projectId === null) return;
  const { issues, effects, clock, policies } = runtime;
  await sweepIssues(projectId, { issues, effects, clock, policies });
  await scheduleSweep(runtime.storage, runtime.clock.now() + runtime.sweepInterval);
}

// --- flow: ProjectDO use cases and steps ---

export async function assignEventStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  summary: EventSummary,
  fingerprints: Fingerprint[],
): Promise<Assignment> {
  await claim(r, projectId);
  return assignEvent(summary, fingerprints, { issues: r.issues, clock: r.clock, ids: r.ids, policies: r.policies });
}

export async function recordReleaseSeenStep(r: ProjectRuntime, projectId: ProjectId, release: Release): Promise<IssueChange[]> {
  await claim(r, projectId);
  return recordReleaseSeen(release, { issues: r.issues, effects: r.effects, clock: r.clock });
}

export async function openReportIssueStep(r: ProjectRuntime, projectId: ProjectId, report: Report): Promise<IssueChange[]> {
  await claim(r, projectId);
  return openReportIssue(report, { issues: r.issues });
}

export async function markSpamStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  reportId: ReportId,
  actor: Member | SpamVerdict,
): Promise<IssueChange[]> {
  await claim(r, projectId);
  return markSpam(reportId, actor, { issues: r.issues, clock: r.clock });
}

export async function recordReplyStep(r: ProjectRuntime, projectId: ProjectId, comment: ReporterComment): Promise<IssueChange[] | Refusal> {
  await claim(r, projectId);
  return recordReply(comment, { issues: r.issues });
}

export async function eraseReportsStep(r: ProjectRuntime, projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
  await claim(r, projectId);
  return eraseReports(reporter, { issues: r.issues });
}

export async function recordShownStatusStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  reportId: ReportId,
  change: ReportStatusChange,
): Promise<void> {
  await claim(r, projectId);
  await r.issues.transact(() => r.issues.recordStatusChange(reportId, change));
}

export async function recordSessionStep(r: ProjectRuntime, projectId: ProjectId, session: Session): Promise<void> {
  await claim(r, projectId);
  await recordSession(session, { issues: r.issues });
}

export async function openMonitorIssueStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  opening: { issueId: IssueId; at: number },
): Promise<IssueChange[]> {
  await claim(r, projectId);
  return openMonitorIssue(opening, { issues: r.issues, effects: r.effects });
}

export async function resolveMonitorIssueStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  resolving: { issueId: IssueId; at: number },
): Promise<IssueChange[]> {
  await claim(r, projectId);
  return resolveMonitorIssue(resolving, { issues: r.issues, effects: r.effects });
}

export async function recordFiringStep(r: ProjectRuntime, projectId: ProjectId, firing: AlertFiring): Promise<void> {
  await claim(r, projectId);
  await r.issues.transact(() => r.issues.recordFiring(firing));
}

export async function addCommentStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  comment: { issueId: IssueId; draft: CommentDraft; actor: Member },
): Promise<IssueChange[]> {
  await claim(r, projectId);
  return addComment(comment.issueId, comment.draft, comment.actor, { issues: r.issues, effects: r.effects, clock: r.clock, ids: r.ids });
}

export async function recordExternalLinkStep(r: ProjectRuntime, projectId: ProjectId, externalLink: ExternalLink): Promise<void> {
  await claim(r, projectId);
  await r.issues.transact(() => r.issues.putExternalLink(externalLink));
}

export async function recordTrackerEventStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  tracked: { issueId: IssueId; event: TrackerEvent; appActor: string; at: number },
): Promise<IssueChange[] | Refusal> {
  await claim(r, projectId);
  const { issueId, ...rest } = tracked;
  return recordTrackerEvent(issueId, rest, { issues: r.issues, effects: r.effects });
}

export async function addTrackerCommentStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  comment: { issueId: IssueId; author: Member; text: string; at: number },
): Promise<IssueChange[] | Refusal> {
  await claim(r, projectId);
  const { issueId, ...rest } = comment;
  return addTrackerComment(issueId, rest, { issues: r.issues, effects: r.effects, ids: r.ids });
}

export async function resolveByCommitStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  fix: { shortId: number; commit: string; at: number },
): Promise<IssueChange[] | Refusal> {
  await claim(r, projectId);
  return resolveByCommit(fix, { issues: r.issues, effects: r.effects });
}

export async function recordCommitShippedStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  shipped: { commit: string; release: Release; at: number },
): Promise<IssueChange[]> {
  await claim(r, projectId);
  return recordCommitShipped(shipped, { issues: r.issues, effects: r.effects });
}

export async function recordFilingStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  filed: { filingKey: string; filing: RecordedFiling },
): Promise<void> {
  await claim(r, projectId);
  await r.issues.transact(() => r.issues.recordFiling(filed.filingKey, filed.filing));
}

// --- flow: reads ---

export async function getReportStep(r: ProjectRuntime, projectId: ProjectId, reportId: ReportId): Promise<Report | null> {
  await claim(r, projectId);
  return r.issues.getReport(reportId);
}

export async function reportsOnStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<readonly Report[]> {
  await claim(r, projectId);
  return r.issues.reportsOn(issueId);
}

export async function reportsByStep(r: ProjectRuntime, projectId: ProjectId, reporter: Reporter): Promise<readonly Report[]> {
  await claim(r, projectId);
  return r.issues.reportsBy(reporter);
}

export async function statusChangesOfStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  reportId: ReportId,
): Promise<readonly ReportStatusChange[]> {
  await claim(r, projectId);
  return r.issues.statusChangesOf(reportId);
}

export async function commentsOnStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<readonly Comment[]> {
  await claim(r, projectId);
  return r.issues.commentsOn(issueId);
}

export async function getIssueStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<IssueState | null> {
  await claim(r, projectId);
  return r.issues.getIssue(issueId);
}

export async function releasesSeenStep(r: ProjectRuntime, projectId: ProjectId): Promise<ReleaseFirstSeen> {
  await claim(r, projectId);
  return r.issues.releaseFirstSeen();
}

export async function sessionTotalsStep(r: ProjectRuntime, projectId: ProjectId, scope: Scope): Promise<SessionTotals> {
  await claim(r, projectId);
  return { sessions: await r.issues.sessionCounts(scope), users: await r.issues.sessionUsers(scope) };
}

export async function countEventsStep(r: ProjectRuntime, projectId: ProjectId, range: Range): Promise<number> {
  await claim(r, projectId);
  return r.issues.countEvents(range);
}

export async function countUsersStep(r: ProjectRuntime, projectId: ProjectId, range: Range): Promise<number> {
  await claim(r, projectId);
  return r.issues.countUsers(range);
}

export async function fingerprintsOfStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<readonly Fingerprint[]> {
  await claim(r, projectId);
  return r.issues.fingerprintsOf(issueId);
}

export async function assigneeOfStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<Assignee | null> {
  await claim(r, projectId);
  return r.issues.assigneeOf(issueId);
}

export async function lastFiringStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  key: { ruleId: string; issueId: IssueId },
): Promise<AlertFiring | null> {
  await claim(r, projectId);
  return r.issues.lastFiring(key);
}

export async function firingsOfStep(r: ProjectRuntime, projectId: ProjectId, ruleId: string): Promise<readonly AlertFiring[]> {
  await claim(r, projectId);
  return r.issues.firingsOf(ruleId);
}

export async function participationsOfStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<readonly Participation[]> {
  await claim(r, projectId);
  return r.issues.participationsOf(issueId);
}

export async function metricValueStep(
  r: ProjectRuntime,
  projectId: ProjectId,
  query: { aggregate: MetricAggregate; since: number },
): Promise<number | null> {
  await claim(r, projectId);
  const issues = await r.issues.listIssues();
  const events = (await Promise.all(issues.map((issue) => r.issues.eventsOf(issue.issueId)))).flat();
  return metricOf({ aggregate: query.aggregate, events, since: query.since });
}

export async function externalLinkOfStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<ExternalLink | null> {
  await claim(r, projectId);
  return r.issues.externalLinkOf(issueId);
}

export async function latestEventOfStep(r: ProjectRuntime, projectId: ProjectId, issueId: IssueId): Promise<EventSummary | null> {
  await claim(r, projectId);
  return latestSummary(await r.issues.eventsOf(issueId));
}

export async function recallFilingStep(r: ProjectRuntime, projectId: ProjectId, filingKey: string): Promise<RecordedFiling | null> {
  await claim(r, projectId);
  return r.issues.recallFiling(filingKey);
}
