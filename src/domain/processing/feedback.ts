/**
 * Feedback items -- the Report Submission an SDK feedback item carries
 * (architecture Mechanism, Stream consumption and processing: feedback
 * items go to fileReport). A `feedback` item is event-shaped, with the
 * message and associated event under its `feedback` context; a legacy
 * `user_report` item carries its text as `comments` and the event it is
 * about as `event_id`. A name or address the item carries is never read:
 * the Reporter is who the forwarded sign-in says. Nothing here validates
 * the message; fileReport does, and refuses an empty one with its Outcome.
 */

import { isObject } from '../normalize/parts.js';
import type { EnvelopeItem } from '../protocol/envelope.js';
import type { ReportSubmission } from '../report/report.js';
import { itemPayload } from './processing.js';

type Raw = Readonly<Record<string, unknown>>;

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

function submissionOf({ message, associatedEventId }: { message: string; associatedEventId: string | null }): ReportSubmission {
  return { message, screenshot: null, associatedEventId };
}

// --- exports ---

export function feedbackSubmission(item: EnvelopeItem): ReportSubmission {
  const raw = itemPayload(item);
  const payload: Raw = isObject(raw) ? raw : {};
  if (item.header.type === LEGACY_REPORT) {
    return submissionOf({ message: textOr(payload['comments'], ''), associatedEventId: idOrNull(payload['event_id']) });
  }
  const feedback = feedbackContext(payload);
  return submissionOf({ message: textOr(feedback['message'], ''), associatedEventId: idOrNull(feedback['associated_event_id']) });
}
