/**
 * FakeIssueStore -- an in-memory IssueStore for use-case tests. Every method
 * is async, so calls from concurrent use cases interleave at each await the
 * way they would against real storage; `transact` serializes whole units of
 * work on a promise chain, as a Durable Object serializes requests. History
 * and the Short Id counter are exposed for assertions.
 */

import type { Fingerprint } from '../../src/domain/grouping/fingerprint.js';
import type { EventId, IssueId } from '../../src/domain/ids.js';
import type { AssignmentTarget, Tombstone } from '../../src/domain/issue/assignment.js';
import type { IssueChange, IssueState } from '../../src/domain/issue/state.js';
import { isHeldBy, type GroupedEvent } from '../../src/domain/issue/tally.js';
import type { Release, ReleaseFirstSeen } from '../../src/domain/release/ordering.js';
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

  async #eventsSince(range: { issueId: IssueId; since: number }): Promise<readonly GroupedEvent[]> {
    return (await this.eventsOf(range.issueId)).filter((event) => event.summary.at >= range.since);
  }
}
