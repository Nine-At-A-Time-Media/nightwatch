/**
 * SqliteIssueStore -- the IssueStore inside ProjectDO, over the Durable
 * Object's SQLite storage (architecture Seams: Per-Project issue state). One
 * object holds one Project, so no row carries a Project id. Building the store
 * runs the schema migrations (issue-store-migrations.ts).
 *
 * Atomicity. `transact` gives the two promises the port makes:
 * - Serialization: units of work are chained on one promise, so a unit starts
 *   only after the one before it settled, even when a unit awaits something
 *   outside storage. The object's single thread means no other caller can run
 *   SQL in the middle of a statement, and the chain means none can start a
 *   unit in the middle of another; that is what makes concurrent first events
 *   of a Fingerprint create one Issue, as the fake's promise chain does.
 * - All or nothing: each unit runs inside `storage.transaction`, so a unit
 *   whose work throws leaves none of its writes behind (the fake only
 *   serializes). The async form is used because use-case work is async;
 *   every store call inside it is synchronous SQL wrapped in a promise.
 *
 * Times are epoch milliseconds.
 */

import type { AlertFiring } from '../../domain/alerts/alert-firing.js';
import type { Assignee } from '../../domain/alerts/issue-alert-rule.js';
import type { Participation } from '../../domain/alerts/notification-settings.js';
import type { Fingerprint } from '../../domain/grouping/fingerprint.js';
import type { EventId, IssueId, ReportId } from '../../domain/ids.js';
import type { AssignmentTarget, Tombstone } from '../../domain/issue/assignment.js';
import type { IssueChange, IssueState } from '../../domain/issue/state.js';
import type { GroupedEvent } from '../../domain/issue/tally.js';
import {
  NO_SESSIONS,
  SESSION_STATUSES,
  type Environment,
  type SessionBucket,
  type SessionCounts,
  type SessionStatus,
  type UserCounts,
} from '../../domain/release/health.js';
import type { Release, ReleaseFirstSeen } from '../../domain/release/ordering.js';
import type { RecordedFiling } from '../../domain/report/filing.js';
import type { Report, Reporter } from '../../domain/report/report.js';
import type { Comment, ReportStatusChange } from '../../domain/report/thread.js';
import type { ExternalLink } from '../../domain/tracker/external-link.js';
import type { IssueStore, StoredForecast } from '../../ports/issue-store.js';
import { migrateIssueStore } from './issue-store-migrations.js';

type Row = Record<string, SqlStorageValue>;

const HOUR = 3_600_000;
const SHORT_ID_COUNTER = 'short_id';

/** Rows whose JSON list column holds any value of the JSON list bound as ?N. */
const holdsAnyOf = (column: string, parameter: number) =>
  `EXISTS (SELECT 1 FROM json_each(${column}) held WHERE held.value IN (SELECT value FROM json_each(?${parameter})))`;

// --- predicates ---

function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value);
}

// --- helpers: rows ---

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`issue store column ${column} is not text`);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number') throw new Error(`issue store column ${column} is not a number`);
  return value;
}

/** A domain value the store wrote as JSON; the store is its only writer. */
function parsed<T>(row: Row, column: string): T {
  return JSON.parse(text(row, column)) as T;
}

function firstParsed<T>(rows: Row[], column: string): T | null {
  const row = rows[0];
  return row === undefined ? null : parsed<T>(row, column);
}

function allParsed<T>(rows: Row[], column: string): T[] {
  return rows.map((row) => parsed<T>(row, column));
}

function reporterKey(reporter: Reporter): string {
  return reporter.email.toLowerCase();
}

function reportIdOf(comment: Comment): ReportId | null {
  return 'report' in comment.author ? comment.author.report : null;
}

/** Event counts per whole hour from `since`, oldest first; a partial last hour is not counted. */
export function hourlyBuckets({ times, since, until }: { times: readonly number[]; since: number; until: number }): number[] {
  const counts: number[] = Array.from({ length: Math.max(0, Math.floor((until - since) / HOUR)) }, () => 0);
  for (const at of times) {
    const hour = Math.floor((at - since) / HOUR);
    if (hour >= 0 && hour < counts.length) counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

/** The mean hourly event count over the clock hours from the first Event to the last, inclusive; 0 with no Events. */
export function normalRate({ events, first, last }: { events: number; first: number; last: number }): number {
  if (events === 0) return 0;
  return events / (Math.floor(last / HOUR) - Math.floor(first / HOUR) + 1);
}

function sessionCountsOf(rows: Row[]): SessionCounts {
  const counts: Record<SessionStatus, number> = { ...NO_SESSIONS };
  for (const row of rows) {
    const status = text(row, 'status');
    if (isSessionStatus(status)) counts[status] += integer(row, 'sessions');
  }
  return counts;
}

// --- store ---

export class SqliteIssueStore implements IssueStore {
  readonly #storage: DurableObjectStorage;
  readonly #sql: SqlStorage;
  readonly #dedupWindow: number;
  #tail: Promise<unknown> = Promise.resolve();

  constructor({ storage, dedupWindow }: { storage: DurableObjectStorage; dedupWindow: number }) {
    this.#storage = storage;
    this.#sql = storage.sql;
    this.#dedupWindow = dedupWindow;
    migrateIssueStore(storage);
  }

  transact<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(() => this.#storage.transaction(() => work()));
    this.#tail = result.catch(() => undefined);
    return result;
  }

  // --- deduplication ---

  async recallAssignment(eventId: EventId, now: number): Promise<AssignmentTarget | null> {
    const rows = this.#rows('SELECT target FROM assignments WHERE event_id = ?1 AND ?2 - at <= ?3', eventId, now, this.#dedupWindow);
    return firstParsed<AssignmentTarget>(rows, 'target');
  }

  /** Remembers the assignment and forgets those past the dedup window. */
  async rememberAssignment(eventId: EventId, target: AssignmentTarget, now: number): Promise<void> {
    this.#sql.exec(
      `INSERT INTO assignments (event_id, target, at) VALUES (?1, ?2, ?3)
       ON CONFLICT (event_id) DO UPDATE SET target = excluded.target, at = excluded.at`,
      eventId,
      JSON.stringify(target),
      now,
    );
    this.#sql.exec('DELETE FROM assignments WHERE ?1 - at > ?2', now, this.#dedupWindow);
  }

  // --- Fingerprints and Tombstones ---

  async findIssueByFingerprints(fingerprints: readonly Fingerprint[]): Promise<IssueId | null> {
    const rows = this.#rows(
      `SELECT f.issue_id FROM json_each(?1) given JOIN fingerprints f ON f.fingerprint = given.value ORDER BY given.key LIMIT 1`,
      JSON.stringify(fingerprints),
    );
    return rows[0] === undefined ? null : text(rows[0], 'issue_id');
  }

  async fingerprintsOf(issueId: IssueId): Promise<readonly Fingerprint[]> {
    return this.#rows('SELECT fingerprint FROM fingerprints WHERE issue_id = ? ORDER BY seq', issueId).map((row) =>
      text(row, 'fingerprint'),
    );
  }

  async attachFingerprints(issueId: IssueId, fingerprints: readonly Fingerprint[]): Promise<void> {
    this.#sql.exec(
      'INSERT OR IGNORE INTO fingerprints (fingerprint, issue_id) SELECT value, ?1 FROM json_each(?2) ORDER BY key',
      issueId,
      JSON.stringify(fingerprints),
    );
  }

  async findTombstone(fingerprints: readonly Fingerprint[]): Promise<Tombstone | null> {
    const rows = this.#rows(
      `SELECT tombstone FROM tombstones WHERE ${holdsAnyOf('fingerprints', 1)} ORDER BY seq LIMIT 1`,
      JSON.stringify(fingerprints),
    );
    return firstParsed<Tombstone>(rows, 'tombstone');
  }

  async putTombstone(tombstone: Tombstone): Promise<void> {
    this.#sql.exec(
      'INSERT INTO tombstones (fingerprints, tombstone) VALUES (?, ?)',
      JSON.stringify(tombstone.fingerprints),
      JSON.stringify(tombstone),
    );
  }

  // --- Issues and History ---

  async assignShortId(issueId: IssueId): Promise<number> {
    const row = this.#sql
      .exec(
        `INSERT INTO counters (name, value) VALUES (?1, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1 RETURNING value`,
        SHORT_ID_COUNTER,
      )
      .one();
    const shortId = integer(row, 'value');
    this.#sql.exec(
      'INSERT INTO short_ids (issue_id, short_id) VALUES (?1, ?2) ON CONFLICT (issue_id) DO UPDATE SET short_id = excluded.short_id',
      issueId,
      shortId,
    );
    return shortId;
  }

  async shortIdOf(issueId: IssueId): Promise<number | null> {
    const rows = this.#rows('SELECT short_id FROM short_ids WHERE issue_id = ?', issueId);
    return rows[0] === undefined ? null : integer(rows[0], 'short_id');
  }

  async getIssue(issueId: IssueId): Promise<IssueState | null> {
    return firstParsed<IssueState>(this.#rows('SELECT state FROM issues WHERE issue_id = ?', issueId), 'state');
  }

  async listIssues(): Promise<readonly IssueState[]> {
    return allParsed<IssueState>(this.#rows('SELECT state FROM issues ORDER BY seq'), 'state');
  }

  async putIssue(state: IssueState): Promise<void> {
    this.#sql.exec(
      'INSERT INTO issues (issue_id, state) VALUES (?1, ?2) ON CONFLICT (issue_id) DO UPDATE SET state = excluded.state',
      state.issueId,
      JSON.stringify(state),
    );
  }

  async removeIssue(issueId: IssueId): Promise<void> {
    for (const table of ['issues', 'forecasts', 'fingerprints', 'events', 'comments']) {
      this.#sql.exec(`DELETE FROM ${table} WHERE issue_id = ?`, issueId);
    }
  }

  async appendHistory(changes: readonly IssueChange[]): Promise<void> {
    for (const change of changes)
      this.#sql.exec('INSERT INTO history (issue_id, change) VALUES (?, ?)', change.issueId, JSON.stringify(change));
  }

  // --- Events and counts ---

  async recordEvent(issueId: IssueId, event: GroupedEvent): Promise<void> {
    this.#sql.exec(
      `INSERT INTO events (event_id, issue_id, at, user_key, fingerprints, event) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (event_id) DO UPDATE SET issue_id = excluded.issue_id, at = excluded.at, user_key = excluded.user_key,
         fingerprints = excluded.fingerprints, event = excluded.event`,
      event.summary.eventId,
      issueId,
      event.summary.at,
      event.summary.userKey,
      JSON.stringify(event.fingerprints),
      JSON.stringify(event),
    );
  }

  async eventsOf(issueId: IssueId): Promise<readonly GroupedEvent[]> {
    return allParsed<GroupedEvent>(this.#rows('SELECT event FROM events WHERE issue_id = ? ORDER BY seq', issueId), 'event');
  }

  async reassignIssue(move: { from: IssueId; to: IssueId }): Promise<void> {
    for (const table of ['fingerprints', 'events', 'comments']) {
      this.#sql.exec(`UPDATE ${table} SET issue_id = ?2 WHERE issue_id = ?1`, move.from, move.to);
    }
    this.#sql.exec(`UPDATE reports SET issue_id = ?2, report = json_set(report, '$.issueId', ?2) WHERE issue_id = ?1`, move.from, move.to);
  }

  async moveFingerprints(move: { from: IssueId; to: IssueId; fingerprints: readonly Fingerprint[] }): Promise<void> {
    const moved = JSON.stringify(move.fingerprints);
    this.#sql.exec(
      'UPDATE fingerprints SET issue_id = ?2 WHERE issue_id = ?1 AND fingerprint IN (SELECT value FROM json_each(?3))',
      move.from,
      move.to,
      moved,
    );
    this.#sql.exec(
      `UPDATE events SET issue_id = ?2 WHERE issue_id = ?1 AND ${holdsAnyOf('events.fingerprints', 3)}`,
      move.from,
      move.to,
      moved,
    );
  }

  async hasUser(issue: { issueId: IssueId; userKey: string }): Promise<boolean> {
    return (
      this.#rows('SELECT 1 AS present FROM events WHERE issue_id = ? AND user_key = ? LIMIT 1', issue.issueId, issue.userKey).length > 0
    );
  }

  async countEvents(range: { issueId: IssueId; since: number }): Promise<number> {
    return integer(this.#one('SELECT COUNT(*) AS n FROM events WHERE issue_id = ? AND at >= ?', range.issueId, range.since), 'n');
  }

  async countUsers(range: { issueId: IssueId; since: number }): Promise<number> {
    const row = this.#one('SELECT COUNT(DISTINCT user_key) AS n FROM events WHERE issue_id = ? AND at >= ?', range.issueId, range.since);
    return integer(row, 'n');
  }

  async hourlyCounts(range: { issueId: IssueId; since: number; until: number }): Promise<readonly number[]> {
    const rows = this.#rows('SELECT at FROM events WHERE issue_id = ? AND at >= ? AND at < ?', range.issueId, range.since, range.until);
    return hourlyBuckets({ times: rows.map((row) => integer(row, 'at')), since: range.since, until: range.until });
  }

  async projectNormalRate(): Promise<number> {
    const row = this.#one('SELECT COUNT(*) AS n, COALESCE(MIN(at), 0) AS first, COALESCE(MAX(at), 0) AS last FROM events');
    return normalRate({ events: integer(row, 'n'), first: integer(row, 'first'), last: integer(row, 'last') });
  }

  async getForecast(issueId: IssueId): Promise<StoredForecast | null> {
    return firstParsed<StoredForecast>(this.#rows('SELECT forecast FROM forecasts WHERE issue_id = ?', issueId), 'forecast');
  }

  async putForecast(issueId: IssueId, forecast: StoredForecast): Promise<void> {
    this.#sql.exec(
      'INSERT INTO forecasts (issue_id, forecast) VALUES (?1, ?2) ON CONFLICT (issue_id) DO UPDATE SET forecast = excluded.forecast',
      issueId,
      JSON.stringify(forecast),
    );
  }

  // --- Releases ---

  async releaseFirstSeen(): Promise<ReleaseFirstSeen> {
    const rows = this.#rows('SELECT release, first_seen FROM releases ORDER BY seq');
    return new Map(rows.map((row) => [text(row, 'release'), integer(row, 'first_seen')]));
  }

  async recordReleaseFirstSeen(release: Release, at: number): Promise<void> {
    this.#sql.exec('INSERT OR IGNORE INTO releases (release, first_seen) VALUES (?, ?)', release, at);
  }

  // --- Reports, Comments and the Report Status shown ---

  async putReport(report: Report): Promise<void> {
    this.#sql.exec(
      `INSERT INTO reports (report_id, issue_id, reporter_email, report) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (report_id) DO UPDATE SET issue_id = excluded.issue_id, reporter_email = excluded.reporter_email, report = excluded.report`,
      report.id,
      report.issueId,
      reporterKey(report.reporter),
      JSON.stringify(report),
    );
  }

  async getReport(reportId: ReportId): Promise<Report | null> {
    return firstParsed<Report>(this.#rows('SELECT report FROM reports WHERE report_id = ?', reportId), 'report');
  }

  async reportsOn(issueId: IssueId): Promise<readonly Report[]> {
    return allParsed<Report>(this.#rows('SELECT report FROM reports WHERE issue_id = ? ORDER BY seq', issueId), 'report');
  }

  async reportsBy(reporter: Reporter): Promise<readonly Report[]> {
    return allParsed<Report>(
      this.#rows('SELECT report FROM reports WHERE reporter_email = ? ORDER BY seq', reporterKey(reporter)),
      'report',
    );
  }

  async removeReport(reportId: ReportId): Promise<void> {
    for (const table of ['reports', 'status_changes', 'comments']) this.#sql.exec(`DELETE FROM ${table} WHERE report_id = ?`, reportId);
  }

  async appendComment(issueId: IssueId, comment: Comment): Promise<void> {
    this.#sql.exec(
      'INSERT INTO comments (issue_id, report_id, comment) VALUES (?, ?, ?)',
      issueId,
      reportIdOf(comment),
      JSON.stringify(comment),
    );
  }

  async commentsOn(issueId: IssueId): Promise<readonly Comment[]> {
    return allParsed<Comment>(this.#rows('SELECT comment FROM comments WHERE issue_id = ? ORDER BY seq', issueId), 'comment');
  }

  async recordStatusChange(reportId: ReportId, change: ReportStatusChange): Promise<void> {
    this.#sql.exec('INSERT INTO status_changes (report_id, change) VALUES (?, ?)', reportId, JSON.stringify(change));
  }

  async statusChangesOf(reportId: ReportId): Promise<readonly ReportStatusChange[]> {
    return allParsed<ReportStatusChange>(
      this.#rows('SELECT change FROM status_changes WHERE report_id = ? ORDER BY seq', reportId),
      'change',
    );
  }

  // --- task-022: Session counters for Release Health ---

  async addSessions(bucket: SessionBucket, quantity: number): Promise<void> {
    this.#sql.exec(
      `INSERT INTO session_buckets (release, environment, status, minute, sessions) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (release, environment, status, minute) DO UPDATE SET sessions = sessions + excluded.sessions`,
      bucket.release,
      bucket.environment,
      bucket.status,
      bucket.minute,
      quantity,
    );
  }

  async markSessionUser(user: { release: Release; environment: Environment; userKey: string; crashed: boolean }): Promise<void> {
    this.#sql.exec(
      `INSERT INTO session_users (release, environment, user_key, crashed) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (release, environment, user_key) DO UPDATE SET crashed = MAX(crashed, excluded.crashed)`,
      user.release,
      user.environment,
      user.userKey,
      user.crashed ? 1 : 0,
    );
  }

  async sessionCounts(scope: { release: Release; environment: Environment }): Promise<SessionCounts> {
    const rows = this.#rows(
      'SELECT status, SUM(sessions) AS sessions FROM session_buckets WHERE release = ? AND environment = ? GROUP BY status',
      scope.release,
      scope.environment,
    );
    return sessionCountsOf(rows);
  }

  async sessionUsers(scope: { release: Release; environment: Environment }): Promise<UserCounts> {
    const row = this.#one(
      'SELECT COUNT(*) AS users, COALESCE(SUM(crashed), 0) AS crashed FROM session_users WHERE release = ? AND environment = ?',
      scope.release,
      scope.environment,
    );
    return { users: integer(row, 'users'), crashedUsers: integer(row, 'crashed') };
  }

  // --- task-021: Assignee, Alert Firings and follow participations ---

  async assigneeOf(issueId: IssueId): Promise<Assignee | null> {
    return firstParsed<Assignee>(this.#rows('SELECT assignee FROM assignees WHERE issue_id = ?', issueId), 'assignee');
  }

  async lastFiring(key: { ruleId: string; issueId: IssueId }): Promise<AlertFiring | null> {
    const rows = this.#rows(
      'SELECT firing FROM firings WHERE rule_id = ? AND issue_id = ? ORDER BY at DESC, seq DESC LIMIT 1',
      key.ruleId,
      key.issueId,
    );
    return firstParsed<AlertFiring>(rows, 'firing');
  }

  async recordFiring(firing: AlertFiring): Promise<void> {
    this.#sql.exec(
      `INSERT INTO firings (rule_id, issue_id, at, firing) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (rule_id, issue_id, at) DO UPDATE SET firing = excluded.firing`,
      firing.ruleId,
      firing.issueId,
      firing.at,
      JSON.stringify(firing),
    );
  }

  async firingsOf(ruleId: string): Promise<readonly AlertFiring[]> {
    return allParsed<AlertFiring>(this.#rows('SELECT firing FROM firings WHERE rule_id = ? ORDER BY seq', ruleId), 'firing');
  }

  async participationsOf(issueId: IssueId): Promise<readonly Participation[]> {
    const rows = this.#rows('SELECT participation FROM participations WHERE issue_id = ? ORDER BY seq', issueId);
    return allParsed<Participation>(rows, 'participation');
  }

  async addParticipation(issueId: IssueId, participation: Participation): Promise<void> {
    this.#sql.exec('INSERT INTO participations (issue_id, participation) VALUES (?, ?)', issueId, JSON.stringify(participation));
  }

  // --- task-011: External Links and Short Id lookup ---

  async putExternalLink(externalLink: ExternalLink): Promise<void> {
    this.#sql.exec(
      'INSERT INTO external_links (issue_id, link) VALUES (?1, ?2) ON CONFLICT (issue_id) DO UPDATE SET link = excluded.link',
      externalLink.issueId,
      JSON.stringify(externalLink),
    );
  }

  async externalLinkOf(issueId: IssueId): Promise<ExternalLink | null> {
    return firstParsed<ExternalLink>(this.#rows('SELECT link FROM external_links WHERE issue_id = ?', issueId), 'link');
  }

  async issueOfShortId(shortId: number): Promise<IssueId | null> {
    const rows = this.#rows('SELECT issue_id FROM short_ids WHERE short_id = ?', shortId);
    return rows[0] === undefined ? null : text(rows[0], 'issue_id');
  }

  // --- task-025: filings recorded under a filing key ---

  async recallFiling(filingKey: string): Promise<RecordedFiling | null> {
    return firstParsed<RecordedFiling>(this.#rows('SELECT filing FROM filings WHERE filing_key = ?', filingKey), 'filing');
  }

  async recordFiling(filingKey: string, filing: RecordedFiling): Promise<void> {
    this.#sql.exec(
      'INSERT INTO filings (filing_key, filing) VALUES (?1, ?2) ON CONFLICT (filing_key) DO UPDATE SET filing = excluded.filing',
      filingKey,
      JSON.stringify(filing),
    );
  }

  // --- queries ---

  #rows(query: string, ...bindings: SqlStorageValue[]): Row[] {
    return this.#sql.exec(query, ...bindings).toArray();
  }

  #one(query: string, ...bindings: SqlStorageValue[]): Row {
    return this.#sql.exec(query, ...bindings).one();
  }
}
