/**
 * Reprocessing -- an operator's reprocess of a Time Range of raw arrivals
 * (design Reprocessing; Behaviors: Reprocess a range, Raw retention
 * expired, Interrupted reprocess, Reprocessing is silent; architecture
 * Mechanism: a subscription at the earliest retained record, records outside
 * the range skipped by their server timestamp).
 *
 * Which records a reprocess takes, when its range has expired, and the
 * subscription it reads through: one name per Project and range, so a rerun
 * of an interrupted reprocess resumes where it stopped.
 */

import type { ArrivalRecord } from '../ingest/arrival.js';
import type { ProjectId } from '../ids.js';
import { isPastRetention } from '../retention/retention.js';
import { isWithinRange, type TimeRange } from '../time-range.js';

/** What a reprocess did: records reprocessed and skipped, and whether it went through the whole range. */
export type Reprocessing = {
  readonly projectId: ProjectId;
  readonly range: TimeRange;
  /** False when it stopped before the end of the range; running it again resumes it. */
  readonly finished: boolean;
  readonly reprocessed: number;
  /** Records of other Projects, or received outside the range. */
  readonly skipped: number;
};

// --- predicates ---

/** A record is reprocessed when it is the Project's and was received within the range. */
export function isReprocessed(record: ArrivalRecord, scope: { projectId: ProjectId; range: TimeRange }): boolean {
  return record.projectId === scope.projectId && isWithinRange(record.receivedAt, scope.range);
}

/** A record received at or after the range's end: the log has passed the range. */
export function isPastRange(record: ArrivalRecord, range: TimeRange): boolean {
  return record.receivedAt >= range.end;
}

/** The range reaches back past Raw Retention, so some of its arrivals are gone. */
export function isRawExpired({ range, now, rawRetention }: { range: TimeRange; now: number; rawRetention: number }): boolean {
  return isPastRetention({ at: range.start, window: rawRetention, now });
}

// --- helpers ---

/** The arrival-log subscription of a Project's reprocess of a range. */
export function reprocessingSubscription({ projectId, range }: { projectId: ProjectId; range: TimeRange }): string {
  return `reprocess:${JSON.stringify([projectId, range.start, range.end])}`;
}
