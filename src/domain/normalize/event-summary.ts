/**
 * Event Summary projection -- the Event Summary (src/domain/event) of a
 * Normalized Event: the facts grouping, counting and alerting need. Built
 * from the scrubbed and source-mapped Event, so it holds no value a
 * Scrubbing Rule removed and its culprit names original source.
 */

import type { EventSummary } from '../event/event-summary.js';
import type { Exception, Frame, NormalizedEvent } from './normalized-event.js';

const UNLABELED = '<unlabeled event>';

// --- predicates ---

function isInApp(frame: Frame): boolean {
  return frame.inApp === true;
}

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

function frameCulprit(frame: Frame): string | null {
  const location = frame.module ?? frame.filename ?? frame.absPath;
  if (location === undefined) return frame.function ?? null;
  return frame.function === undefined ? location : `${location} in ${frame.function}`;
}

/** Frames run oldest call first, so the innermost in-app frame (else the innermost frame) is where it broke. */
function culprit(event: NormalizedEvent): string | null {
  if (event.transaction !== null) return event.transaction;
  const frames = event.exceptions.at(-1)?.frames ?? event.stacktrace ?? [];
  const frame = frames.findLast(isInApp) ?? frames.at(-1);
  return frame === undefined ? null : frameCulprit(frame);
}

// --- exports ---

export function toEventSummary(event: NormalizedEvent, userKey: string | null): EventSummary {
  return {
    eventId: event.eventId,
    at: event.timestamp,
    release: event.release,
    environment: event.environment,
    level: event.level,
    userKey,
    title: title(event),
    culprit: culprit(event),
  };
}
