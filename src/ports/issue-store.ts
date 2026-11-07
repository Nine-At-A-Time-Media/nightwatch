/**
 * IssueStore -- one Project's issue state (architecture Seams: Per-Project
 * issue state): Issues, their Fingerprints and Events, Tombstones, History,
 * hourly counts, Forecasts and the Releases first seen. Durable Object
 * SQLite inside ProjectDO in production, an in-memory fake in tests.
 *
 * Atomicity: `transact` runs its work as one transaction, and transactions
 * on one Project's store never interleave. That is what makes concurrent
 * first events of a Fingerprint create exactly one Issue. Times are epoch
 * milliseconds.
 */

import type { Fingerprint } from '../domain/grouping/fingerprint.js';
import type { EventId, IssueId } from '../domain/ids.js';
import type { AssignmentTarget, Tombstone } from '../domain/issue/assignment.js';
import type { Forecast } from '../domain/issue/forecast.js';
import type { IssueChange, IssueState } from '../domain/issue/state.js';
import type { GroupedEvent } from '../domain/issue/tally.js';
import type { Release, ReleaseFirstSeen } from '../domain/release/ordering.js';

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
  /** Removes the Issue with its Fingerprints, Events and Forecast. */
  removeIssue(issueId: IssueId): Promise<void>;
  appendHistory(changes: readonly IssueChange[]): Promise<void>;

  // --- Events and counts ---

  recordEvent(issueId: IssueId, event: GroupedEvent): Promise<void>;
  eventsOf(issueId: IssueId): Promise<readonly GroupedEvent[]>;
  /** Moves every Fingerprint and Event (and whatever else the Issue holds) of `from` to `to`. */
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
}
