/**
 * Feedback items -- the Report Submission an SDK feedback item carries
 * (architecture Mechanism, Stream consumption and processing: feedback
 * items go to fileReport). A `feedback` item is event-shaped, with the
 * message and associated event under its `feedback` context; a legacy
 * `user_report` item carries its text as `comments` and the event it is
 * about as `event_id`. A name or address the item carries is never read:
 * the Reporter is who the forwarded sign-in says. Nothing here validates
 * the message; fileReport does, and refuses an empty one with its Outcome.
 *
 * The filing key that makes filing idempotent is a `feedback` item's own
 * event id, so an SDK resend files nothing new. A legacy item's `event_id`
 * names the Event it is about, not the item, so it, and a `feedback` item
 * with no id, is keyed by where it sits: its Arrival Record and its index
 * there, which a redelivery repeats.
 */

import { isObject } from '../normalize/parts.js';
import type { EnvelopeItem } from '../protocol/envelope.js';
import type { ReportSubmission } from '../report/report.js';
import { itemPayload } from './processing.js';

type Raw = Readonly<Record<string, unknown>>;

/** Where an item sits: the id of its Arrival Record and its index among that record's items. */
export type ItemPlace = { readonly recordId: string; readonly index: number };

const LEGACY_REPORT = 'user_report';

// --- helpers ---

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function feedbackContext(payload: Raw): Raw {
  const contexts = payload['contexts'];
  const feedback = isObject(contexts) ? contexts['feedback'] : undefined;
  return isObject(feedback) ? feedback : {};
}

function placeKey(place: ItemPlace): string {
  return `${place.recordId}/${place.index}`;
}

function submissionOf(read: { message: string; associatedEventId: string | null; filingKey: string }): ReportSubmission {
  return { message: read.message, screenshot: null, associatedEventId: read.associatedEventId, filingKey: read.filingKey };
}

// --- exports ---

export function feedbackSubmission(item: EnvelopeItem, place: ItemPlace): ReportSubmission {
  const raw = itemPayload(item);
  const payload: Raw = isObject(raw) ? raw : {};
  if (item.header.type === LEGACY_REPORT) {
    const associatedEventId = idOrNull(payload['event_id']);
    return submissionOf({ message: textOr(payload['comments'], ''), associatedEventId, filingKey: placeKey(place) });
  }
  const feedback = feedbackContext(payload);
  return submissionOf({
    message: textOr(feedback['message'], ''),
    associatedEventId: idOrNull(feedback['associated_event_id']),
    filingKey: idOrNull(payload['event_id']) ?? placeKey(place),
  });
}
