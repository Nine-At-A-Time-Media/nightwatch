/**
 * IssueStore -- one Project's issue state (architecture Seams: Per-Project
 * issue state): Issues, their Fingerprints and Events, Tombstones, History,
 * hourly counts, Forecasts, the Releases first seen, and the Reports,
 * Comments and shown Report Status changes the Issues hold, and the
 * per-minute Session counters Release Health reads. Durable Object
 * SQLite inside ProjectDO in production, an in-memory fake in tests.
 *
 * Atomicity: `transact` runs its work as one transaction, and transactions
 * on one Project's store never interleave. That is what makes concurrent
 * first events of a Fingerprint create exactly one Issue. Times are epoch
 * milliseconds.
 */

import type { AlertFiring } from '../domain/alerts/alert-firing.js';
import type { Assignee } from '../domain/alerts/issue-alert-rule.js';
import type { Participation } from '../domain/alerts/notification-settings.js';
import type { Fingerprint } from '../domain/grouping/fingerprint.js';
import type { EventId, IssueId, ReportId } from '../domain/ids.js';
import type { AssignmentTarget, Tombstone } from '../domain/issue/assignment.js';
import type { Forecast } from '../domain/issue/forecast.js';
import type { IssueChange, IssueState } from '../domain/issue/state.js';
import type { GroupedEvent } from '../domain/issue/tally.js';
import type { Environment, SessionBucket, SessionCounts, UserCounts } from '../domain/release/health.js';
import type { Release, ReleaseFirstSeen } from '../domain/release/ordering.js';
import type { RecordedFiling } from '../domain/report/filing.js';
import type { Report, Reporter } from '../domain/report/report.js';
import type { Comment, ReportStatusChange } from '../domain/report/thread.js';
import type { ExternalLink } from '../domain/tracker/external-link.js';

/** A Forecast with the time it was computed, so a sweep knows when to refresh it. */
export type StoredForecast = Forecast & { readonly computedAt: number };

export interface IssueStore {
  /** Runs `work` as one transaction; no other transaction on this store runs until it settles. */
  transact<T>(work: () => Promise<T>): Promise<T>;

  // --- deduplication: an Event Id is remembered for the store's dedup window ---

  /** Where an Event Id was assigned, if it was assigned within the dedup window before `now`. */
  recallAssignment(eventId: EventId, now: number): Promise<AssignmentTarget | null>;
  rememberAssignment(eventId: EventId, target: AssignmentTarget, now: number): Promise<void>;

  // --- Fingerprints and Tombstones ---

  /** The Issue holding any of the Fingerprints, or null. */
  findIssueByFingerprints(fingerprints: readonly Fingerprint[]): Promise<IssueId | null>;
  fingerprintsOf(issueId: IssueId): Promise<readonly Fingerprint[]>;
  /** Attaches the Fingerprints no Issue holds yet; one held by another Issue stays with it. */
  attachFingerprints(issueId: IssueId, fingerprints: readonly Fingerprint[]): Promise<void>;
  /** The Tombstone holding any of the Fingerprints, or null. */
  findTombstone(fingerprints: readonly Fingerprint[]): Promise<Tombstone | null>;
  putTombstone(tombstone: Tombstone): Promise<void>;

  // --- Issues and History ---

  /** Gives the Issue the next Short Id of this Project and returns it; Short Ids are never reused. */
  assignShortId(issueId: IssueId): Promise<number>;
  shortIdOf(issueId: IssueId): Promise<number | null>;
  getIssue(issueId: IssueId): Promise<IssueState | null>;
  listIssues(): Promise<readonly IssueState[]>;
  putIssue(state: IssueState): Promise<void>;
  /** Removes the Issue with its Fingerprints, Events, Comments and Forecast. */
  removeIssue(issueId: IssueId): Promise<void>;
  appendHistory(changes: readonly IssueChange[]): Promise<void>;

  // --- Events and counts ---

  recordEvent(issueId: IssueId, event: GroupedEvent): Promise<void>;
  eventsOf(issueId: IssueId): Promise<readonly GroupedEvent[]>;
  /** Moves every Fingerprint, Event, Report and Comment (whatever the Issue holds) of `from` to `to`. */
  reassignIssue(move: { from: IssueId; to: IssueId }): Promise<void>;
  /** Moves the Fingerprints, and the Events grouped by any of them, from one Issue to another. */
  moveFingerprints(move: { from: IssueId; to: IssueId; fingerprints: readonly Fingerprint[] }): Promise<void>;
  hasUser(issue: { issueId: IssueId; userKey: string }): Promise<boolean>;
  /** Events of the Issue at or after `since`. */
  countEvents(range: { issueId: IssueId; since: number }): Promise<number>;
  /** Distinct users of the Issue's Events at or after `since`. */
  countUsers(range: { issueId: IssueId; since: number }): Promise<number>;
  /** The Issue's event count per whole clock hour from `since` up to `until`, oldest first. */
  hourlyCounts(range: { issueId: IssueId; since: number; until: number }): Promise<readonly number[]>;
  /** The Project's normal hourly event rate. */
  projectNormalRate(): Promise<number>;
  getForecast(issueId: IssueId): Promise<StoredForecast | null>;
  putForecast(issueId: IssueId, forecast: StoredForecast): Promise<void>;

  // --- Releases ---

  releaseFirstSeen(): Promise<ReleaseFirstSeen>;
  recordReleaseFirstSeen(release: Release, at: number): Promise<void>;

  // --- Reports, Comments and the Report Status shown ---

  putReport(report: Report): Promise<void>;
  getReport(reportId: ReportId): Promise<Report | null>;
  /** The Reports attached to the Issue. */
  reportsOn(issueId: IssueId): Promise<readonly Report[]>;
  /** The Reports filed by the Reporter, matched by address without regard to case. */
  reportsBy(reporter: Reporter): Promise<readonly Report[]>;
  /** Removes the Report, the Report Status changes it showed, and the replies written on it. */
  removeReport(reportId: ReportId): Promise<void>;
  appendComment(issueId: IssueId, comment: Comment): Promise<void>;
  /** The Comments on the Issue, oldest first. */
  commentsOn(issueId: IssueId): Promise<readonly Comment[]>;
  recordStatusChange(reportId: ReportId, change: ReportStatusChange): Promise<void>;
  /** The changes of the Report Status the Report's Reporter was shown, oldest first. */
  statusChangesOf(reportId: ReportId): Promise<readonly ReportStatusChange[]>;

  // --- task-022: Session counters for Release Health ---

  /** Adds `quantity` Sessions to the bucket's per-minute counter. */
  addSessions(bucket: SessionBucket, quantity: number): Promise<void>;
  /** Records a user's Session for the release and environment; once one crashed, the user stays crashed there. */
  markSessionUser(user: { release: Release; environment: Environment; userKey: string; crashed: boolean }): Promise<void>;
  /** Sessions per status for the release and environment, summed over every minute. */
  sessionCounts(scope: { release: Release; environment: Environment }): Promise<SessionCounts>;
  /** Distinct users with a Session for the release and environment, and how many of them crashed. */
  sessionUsers(scope: { release: Release; environment: Environment }): Promise<UserCounts>;
  // --- task-021: Assignee, Alert Firings (the quiet-period row) and follow participations ---

  /** The Issue's Assignee, or null when it has none. */
  assigneeOf(issueId: IssueId): Promise<Assignee | null>;
  /** The latest firing of the rule for the Issue, or null when it never fired for it. */
  lastFiring(key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null>;
  /** Saves the firing, replacing the one with the same rule, Issue and time. */
  recordFiring(firing: AlertFiring): Promise<void>;
  /** Every firing of the rule kept in this Project, oldest first. */
  firingsOf(ruleId: string): Promise<readonly AlertFiring[]>;
  /** Each reason a Member follows the Issue. */
  participationsOf(issueId: IssueId): Promise<readonly Participation[]>;
  addParticipation(issueId: IssueId, participation: Participation): Promise<void>;
  // --- task-011: External Links and Short Id lookup ---

  /** Saves the Issue's External Link, replacing the one it had. */
  putExternalLink(externalLink: ExternalLink): Promise<void>;
  /** The Issue's External Link, Linked or Broken; null when it has none. */
  externalLinkOf(issueId: IssueId): Promise<ExternalLink | null>;
  /** The Issue the Short Id counter names in this Project, or null. */
  issueOfShortId(shortId: number): Promise<IssueId | null>;
  // --- task-025: filings recorded under a filing key ---

  /** What was filed under the filing key in this Project, or null when nothing was. */
  recallFiling(filingKey: string): Promise<RecordedFiling | null>;
  /** Records the filing under the key, replacing what it held. */
  recordFiling(filingKey: string, filing: RecordedFiling): Promise<void>;
  // --- task-027: Assignee writes and Report moves ---

  /** Saves the Issue's Assignee, replacing the one it had; null leaves it with none. */
  setAssignee(issueId: IssueId, assignee: Assignee | null): Promise<void>;
  /** Attaches the Report to the Issue, moving the replies written on it there too. */
  moveReport(move: { reportId: ReportId; to: IssueId }): Promise<void>;
}
