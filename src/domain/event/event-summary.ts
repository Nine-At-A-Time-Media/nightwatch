/**
 * Event Summary -- the facts about one Event that grouping, counting and
 * alerting need (design Values the behaviors exchange). Built after
 * scrubbing, so it holds no value a Scrubbing Rule removed. Times are epoch
 * milliseconds. Also names where the scrubbed Event is stored.
 */

import type { EventId } from '../ids.js';
import type { Level } from '../issue/priority.js';
import type { Release } from '../release/ordering.js';

export type EventSummary = {
  readonly eventId: EventId;
  readonly at: number;
  readonly release: Release | null;
  readonly environment: string | null;
  readonly level: Level;
  /** The affected user's hashed key; null when the Event names no user. */
  readonly userKey: string | null;
  readonly title: string;
  readonly culprit: string | null;
};

const EVENTS_PREFIX = 'events/';

// --- exports ---

/** The BlobStore key of a stored Event. */
export function eventBlobKey(eventId: EventId): string {
  return `${EVENTS_PREFIX}${eventId}`;
}
