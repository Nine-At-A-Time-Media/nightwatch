/**
 * Event Summary draft -- the facts about one Event that grouping, counting
 * and alerting need (design Values the behaviors exchange, Event Summary).
 * Built from the scrubbed Event, so it holds no value a Scrubbing Rule
 * removed. Named a draft until it is reconciled with the Event Summary the
 * issue use cases own.
 */

import type { Level } from '../issue/priority.js';
import type { Exception, NormalizedEvent } from './normalized-event.js';

export type EventSummaryDraft = {
  readonly eventId: string;
  readonly projectId: string;
  /** Event time, epoch milliseconds, after clock-drift correction. */
  readonly at: number;
  readonly level: Level;
  readonly platform: string;
  readonly release: string | null;
  readonly environment: string | null;
  /** A stable key for the Event's user, chosen by the caller; null when the Event names no user. */
  readonly userKey: string | null;
  /** The one-line label of the Event: its main exception, else its message. */
  readonly title: string;
  readonly transaction: string | null;
  readonly logger: string | null;
  readonly tags: Readonly<Record<string, string>>;
};

const UNLABELED = '<unlabeled event>';

// --- helpers ---

function exceptionTitle(exception: Exception): string | null {
  if (exception.type !== null && exception.value !== null) return `${exception.type}: ${exception.value}`;
  return exception.type ?? exception.value;
}

/** The SDK sends the chain cause first, so the exception it raised last is the main one. */
function title(event: NormalizedEvent): string {
  const main = event.exceptions.at(-1);
  return (main && exceptionTitle(main)) ?? event.message?.formatted ?? event.message?.template ?? UNLABELED;
}

// --- exports ---

export function toEventSummary(event: NormalizedEvent, userKey: string | null): EventSummaryDraft {
  return {
    eventId: event.eventId,
    projectId: event.projectId,
    at: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    userKey,
    title: title(event),
    transaction: event.transaction,
    logger: event.logger,
    tags: event.tags,
  };
}
