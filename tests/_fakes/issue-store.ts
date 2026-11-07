/**
 * FakeIssueStore -- an in-memory IssueStore for use-case tests. Every method
 * is async, so calls from concurrent use cases interleave at each await the
 * way they would against real storage; `transact` serializes whole units of
 * work on a promise chain, as a Durable Object serializes requests. History
 * and the Short Id counter are exposed for assertions.
 */

import type { AlertFiring } from '../../src/domain/alerts/alert-firing.js';
import type { Assignee } from '../../src/domain/alerts/issue-alert-rule.js';
import type { Participation } from '../../src/domain/alerts/notification-settings.js';
import type { Fingerprint } from '../../src/domain/grouping/fingerprint.js';
import type { EventId, IssueId, ReportId } from '../../src/domain/ids.js';
import type { AssignmentTarget, Tombstone } from '../../src/domain/issue/assignment.js';
import type { IssueChange, IssueState } from '../../src/domain/issue/state.js';
import { isHeldBy, type GroupedEvent } from '../../src/domain/issue/tally.js';
import {
  NO_SESSIONS,
  type Environment,
  type SessionBucket,
  type SessionCounts,
  type SessionStatus,
  type UserCounts,
} from '../../src/domain/release/health.js';
import type { Release, ReleaseFirstSeen } from '../../src/domain/release/ordering.js';
import type { RecordedFiling } from '../../src/domain/report/filing.js';
import type { Report, Reporter } from '../../src/domain/report/report.js';
import type { Comment, ReportStatusChange } from '../../src/domain/report/thread.js';
import type { ExternalLink } from '../../src/domain/tracker/external-link.js';
import type { IssueStore, StoredForecast } from '../../src/ports/issue-store.js';

const HOUR = 3_600_000;

type Remembered = { readonly target: AssignmentTarget; readonly at: number };

export class FakeIssueStore implements IssueStore {
  readonly history: IssueChange[] = [];
  readonly #dedupWindow: number;
  #normalRate: number;
  #tail: Promise<unknown> = Promise.resolve();
  #nextShortId = 1;
  readonly #issues = new Map<IssueId, IssueState>();
  readonly #shortIds = new Map<IssueId, number>();
  readonly #owners = new Map<Fingerprint, IssueId>();
  readonly #events = new Map<EventId, { issueId: IssueId; event: GroupedEvent }>();
  readonly #remembered = new Map<EventId, Remembered>();
  readonly #tombstones: Tombstone[] = [];
  readonly #forecasts = new Map<IssueId, StoredForecast>();
  readonly #releases = new Map<Release, number>();
  readonly #reports = new Map<ReportId, Report>();
  readonly #comments: { issueId: IssueId; comment: Comment }[] = [];
  readonly #statusChanges = new Map<ReportId, ReportStatusChange[]>();
  // --- task-022: Session counters ---
  readonly #sessionBuckets = new Map<string, SessionBucket & { sessions: number }>();
  readonly #sessionUsers = new Map<string, { release: Release; environment: Environment; crashed: boolean }>();
  // --- task-021: Assignee, Alert Firings and follow participations ---
  readonly #assignees = new Map<IssueId, Assignee>();
  readonly #firings: AlertFiring[] = [];
  readonly #participations: { issueId: IssueId; participation: Participation }[] = [];
  readonly #externalLinks = new Map<IssueId, ExternalLink>();
  // --- task-025: filings recorded under a filing key ---
  readonly #filings = new Map<string, RecordedFiling>();

  constructor(options: { dedupWindow: number; projectNormalRate?: number }) {
    this.#dedupWindow = options.dedupWindow;
    this.#normalRate = options.projectNormalRate ?? 1;
  }

  setProjectNormalRate(rate: number): void {
    this.#normalRate = rate;
  }

  transact<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(() => work());
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async recallAssignment(eventId: EventId, now: number): Promise<AssignmentTarget | null> {
    const remembered = this.#remembered.get(eventId);
    return remembered && now - remembered.at <= this.#dedupWindow ? remembered.target : null;
  }

  async rememberAssignment(eventId: EventId, target: AssignmentTarget, now: number): Promise<void> {
    this.#remembered.set(eventId, { target, at: now });
  }

  async findIssueByFingerprints(fingerprints: readonly Fingerprint[]): Promise<IssueId | null> {
    return fingerprints.map((fingerprint) => this.#owners.get(fingerprint)).find((id) => id !== undefined) ?? null;
  }

  async fingerprintsOf(issueId: IssueId): Promise<readonly Fingerprint[]> {
    return [...this.#owners].filter(([, owner]) => owner === issueId).map(([fingerprint]) => fingerprint);
  }

  async attachFingerprints(issueId: IssueId, fingerprints: readonly Fingerprint[]): Promise<void> {
    fingerprints.filter((fingerprint) => !this.#owners.has(fingerprint)).forEach((fingerprint) => this.#owners.set(fingerprint, issueId));
  }

  async findTombstone(fingerprints: readonly Fingerprint[]): Promise<Tombstone | null> {
    return this.#tombstones.find((tombstone) => tombstone.fingerprints.some((fingerprint) => fingerprints.includes(fingerprint))) ?? null;
  }

  async putTombstone(tombstone: Tombstone): Promise<void> {
    this.#tombstones.push(tombstone);
  }

  async assignShortId(issueId: IssueId): Promise<number> {
    const shortId = this.#nextShortId++;
    this.#shortIds.set(issueId, shortId);
    return shortId;
  }

  async shortIdOf(issueId: IssueId): Promise<number | null> {
    return this.#shortIds.get(issueId) ?? null;
  }

  async getIssue(issueId: IssueId): Promise<IssueState | null> {
    return this.#issues.get(issueId) ?? null;
  }

  async listIssues(): Promise<readonly IssueState[]> {
    return [...this.#issues.values()];
  }

  async putIssue(state: IssueState): Promise<void> {
    this.#issues.set(state.issueId, state);
  }

  async removeIssue(issueId: IssueId): Promise<void> {
    this.#issues.delete(issueId);
    this.#forecasts.delete(issueId);
    [...this.#owners].filter(([, owner]) => owner === issueId).forEach(([fingerprint]) => this.#owners.delete(fingerprint));
    [...this.#events].filter(([, held]) => held.issueId === issueId).forEach(([eventId]) => this.#events.delete(eventId));
    this.#removeComments((held) => held.issueId === issueId);
  }

  async appendHistory(changes: readonly IssueChange[]): Promise<void> {
    this.history.push(...changes);
  }

  async recordEvent(issueId: IssueId, event: GroupedEvent): Promise<void> {
    this.#events.set(event.summary.eventId, { issueId, event });
  }

  async eventsOf(issueId: IssueId): Promise<readonly GroupedEvent[]> {
    return [...this.#events.values()].filter((held) => held.issueId === issueId).map((held) => held.event);
  }

  async reassignIssue(move: { from: IssueId; to: IssueId }): Promise<void> {
    [...this.#owners].filter(([, owner]) => owner === move.from).forEach(([fingerprint]) => this.#owners.set(fingerprint, move.to));
    [...this.#events]
      .filter(([, held]) => held.issueId === move.from)
      .forEach(([eventId, held]) => this.#events.set(eventId, { issueId: move.to, event: held.event }));
    [...this.#reports.values()]
      .filter((report) => report.issueId === move.from)
      .forEach((report) => this.#reports.set(report.id, { ...report, issueId: move.to }));
    this.#comments.filter((held) => held.issueId === move.from).forEach((held) => (held.issueId = move.to));
  }

  async moveFingerprints(move: { from: IssueId; to: IssueId; fingerprints: readonly Fingerprint[] }): Promise<void> {
    move.fingerprints
      .filter((fingerprint) => this.#owners.get(fingerprint) === move.from)
      .forEach((fingerprint) => this.#owners.set(fingerprint, move.to));
    [...this.#events]
      .filter(([, held]) => held.issueId === move.from && isHeldBy(held.event, move.fingerprints))
      .forEach(([eventId, held]) => this.#events.set(eventId, { issueId: move.to, event: held.event }));
  }

  async hasUser(issue: { issueId: IssueId; userKey: string }): Promise<boolean> {
    return (await this.eventsOf(issue.issueId)).some((event) => event.summary.userKey === issue.userKey);
  }

  async countEvents(range: { issueId: IssueId; since: number }): Promise<number> {
    return (await this.#eventsSince(range)).length;
  }

  async countUsers(range: { issueId: IssueId; since: number }): Promise<number> {
    const users = (await this.#eventsSince(range)).flatMap((event) => (event.summary.userKey === null ? [] : [event.summary.userKey]));
    return new Set(users).size;
  }

  async hourlyCounts(range: { issueId: IssueId; since: number; until: number }): Promise<readonly number[]> {
    const events = await this.eventsOf(range.issueId);
    const hours = Math.max(0, Math.floor((range.until - range.since) / HOUR));
    return Array.from({ length: hours }, (_, i) => {
      const start = range.since + i * HOUR;
      return events.filter((event) => event.summary.at >= start && event.summary.at < start + HOUR).length;
    });
  }

  async projectNormalRate(): Promise<number> {
    return this.#normalRate;
  }

  async getForecast(issueId: IssueId): Promise<StoredForecast | null> {
    return this.#forecasts.get(issueId) ?? null;
  }

  async putForecast(issueId: IssueId, forecast: StoredForecast): Promise<void> {
    this.#forecasts.set(issueId, forecast);
  }

  async releaseFirstSeen(): Promise<ReleaseFirstSeen> {
    return new Map(this.#releases);
  }

  async recordReleaseFirstSeen(release: Release, at: number): Promise<void> {
    if (!this.#releases.has(release)) this.#releases.set(release, at);
  }

  async putReport(report: Report): Promise<void> {
    this.#reports.set(report.id, report);
  }

  async getReport(reportId: ReportId): Promise<Report | null> {
    return this.#reports.get(reportId) ?? null;
  }

  async reportsOn(issueId: IssueId): Promise<readonly Report[]> {
    return [...this.#reports.values()].filter((report) => report.issueId === issueId);
  }

  async reportsBy(reporter: Reporter): Promise<readonly Report[]> {
    const email = reporter.email.toLowerCase();
    return [...this.#reports.values()].filter((report) => report.reporter.email.toLowerCase() === email);
  }

  async removeReport(reportId: ReportId): Promise<void> {
    this.#reports.delete(reportId);
    this.#statusChanges.delete(reportId);
    this.#removeComments(({ comment }) => 'report' in comment.author && comment.author.report === reportId);
  }

  async appendComment(issueId: IssueId, comment: Comment): Promise<void> {
    this.#comments.push({ issueId, comment });
  }

  async commentsOn(issueId: IssueId): Promise<readonly Comment[]> {
    return this.#comments.filter((held) => held.issueId === issueId).map((held) => held.comment);
  }

  async recordStatusChange(reportId: ReportId, change: ReportStatusChange): Promise<void> {
    this.#statusChanges.set(reportId, [...(this.#statusChanges.get(reportId) ?? []), change]);
  }

  async statusChangesOf(reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return this.#statusChanges.get(reportId) ?? [];
  }

  // --- task-022: Session counters for Release Health ---

  async addSessions(bucket: SessionBucket, quantity: number): Promise<void> {
    const key = JSON.stringify([bucket.release, bucket.environment, bucket.status, bucket.minute]);
    const held = this.#sessionBuckets.get(key);
    this.#sessionBuckets.set(key, { ...bucket, sessions: (held?.sessions ?? 0) + quantity });
  }

  async markSessionUser(user: { release: Release; environment: Environment; userKey: string; crashed: boolean }): Promise<void> {
    const key = JSON.stringify([user.release, user.environment, user.userKey]);
    const held = this.#sessionUsers.get(key);
    this.#sessionUsers.set(key, {
      release: user.release,
      environment: user.environment,
      crashed: (held?.crashed ?? false) || user.crashed,
    });
  }

  async sessionCounts(scope: { release: Release; environment: Environment }): Promise<SessionCounts> {
    const counts: Record<SessionStatus, number> = { ...NO_SESSIONS };
    for (const bucket of this.#sessionBuckets.values()) {
      if (bucket.release === scope.release && bucket.environment === scope.environment) counts[bucket.status] += bucket.sessions;
    }
    return counts;
  }

  async sessionUsers(scope: { release: Release; environment: Environment }): Promise<UserCounts> {
    const users = [...this.#sessionUsers.values()].filter(
      (user) => user.release === scope.release && user.environment === scope.environment,
    );
    return { users: users.length, crashedUsers: users.filter((user) => user.crashed).length };
  }

  /** Every per-minute Session counter, oldest minute first, for assertions. */
  sessionBuckets(): readonly (SessionBucket & { sessions: number })[] {
    return [...this.#sessionBuckets.values()].sort((a, b) => a.minute - b.minute);
  }

  // --- task-011: External Links and Short Id lookup ---

  async putExternalLink(externalLink: ExternalLink): Promise<void> {
    this.#externalLinks.set(externalLink.issueId, externalLink);
  }

  async externalLinkOf(issueId: IssueId): Promise<ExternalLink | null> {
    return this.#externalLinks.get(issueId) ?? null;
  }

  async issueOfShortId(shortId: number): Promise<IssueId | null> {
    return [...this.#shortIds].find(([, counter]) => counter === shortId)?.[0] ?? null;
  }

  #removeComments(matches: (held: { issueId: IssueId; comment: Comment }) => boolean): void {
    const kept = this.#comments.filter((held) => !matches(held));
    this.#comments.splice(0, this.#comments.length, ...kept);
  }

  async #eventsSince(range: { issueId: IssueId; since: number }): Promise<readonly GroupedEvent[]> {
    return (await this.eventsOf(range.issueId)).filter((event) => event.summary.at >= range.since);
  }

  // --- task-021: Assignee, Alert Firings and follow participations ---

  /** Test helper: sets the Issue's Assignee, as a triage action would. */
  setAssignee(issueId: IssueId, assignee: Assignee | null): void {
    if (assignee === null) this.#assignees.delete(issueId);
    else this.#assignees.set(issueId, assignee);
  }

  async assigneeOf(issueId: IssueId): Promise<Assignee | null> {
    return this.#assignees.get(issueId) ?? null;
  }

  async lastFiring(key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null> {
    const firings = this.#firings.filter((firing) => firing.ruleId === key.ruleId && firing.issueId === key.issueId);
    return firings.reduce<AlertFiring | null>((latest, firing) => (latest === null || firing.at >= latest.at ? firing : latest), null);
  }

  async recordFiring(firing: AlertFiring): Promise<void> {
    const index = this.#firings.findIndex(
      (kept) => kept.ruleId === firing.ruleId && kept.issueId === firing.issueId && kept.at === firing.at,
    );
    if (index === -1) this.#firings.push(firing);
    else this.#firings[index] = firing;
  }

  async firingsOf(ruleId: string): Promise<readonly AlertFiring[]> {
    return this.#firings.filter((firing) => firing.ruleId === ruleId);
  }

  async participationsOf(issueId: IssueId): Promise<readonly Participation[]> {
    return this.#participations.filter((held) => held.issueId === issueId).map((held) => held.participation);
  }

  async addParticipation(issueId: IssueId, participation: Participation): Promise<void> {
    this.#participations.push({ issueId, participation });
  }

  // --- task-025: filings recorded under a filing key ---

  async recallFiling(filingKey: string): Promise<RecordedFiling | null> {
    return this.#filings.get(filingKey) ?? null;
  }

  async recordFiling(filingKey: string, filing: RecordedFiling): Promise<void> {
    this.#filings.set(filingKey, filing);
  }

  // --- task-031: retention expiry ---

  async removeEventsBefore(cutoff: number): Promise<readonly EventId[]> {
    const expired = [...this.#events].filter(([, held]) => held.event.summary.at < cutoff).map(([eventId]) => eventId);
    expired.forEach((eventId) => this.#events.delete(eventId));
    return expired;
  }

  async reportsFiledBefore(cutoff: number): Promise<readonly Report[]> {
    return [...this.#reports.values()].filter((report) => report.filedAt < cutoff);
  }

  async forgetFilingsOf(reportIds: readonly ReportId[]): Promise<void> {
    [...this.#filings].filter(([, filing]) => reportIds.includes(filing.reportId)).forEach(([key]) => this.#filings.delete(key));
  }
}
