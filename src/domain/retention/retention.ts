/**
 * Retention -- how long each kind of data is kept (design Retention and
 * data handling: Windows, Expiry, Order; Parameters: Raw, Event,
 * Attachment, Report, Outcome and History Retention). The RetentionPolicy
 * is a parameter set per Organization (architecture Seams: Retention), and
 * Expiry is what one retention pass removed from a Project.
 *
 * Windows are milliseconds; times are epoch milliseconds. A time exactly
 * one window old is still kept; older is past retention.
 */

/** Each kind of data's retention window. */
export type RetentionPolicy = {
  readonly raw: number;
  readonly event: number;
  readonly attachment: number;
  readonly report: number;
  readonly outcome: number;
  readonly history: number;
};

/** What one retention pass removed from a Project: Events, Issues left with nothing to hold, and Reports. */
export type Expiry = { readonly events: number; readonly issues: number; readonly reports: number };

// --- predicates ---

/** True when data from `at` is older than the window before `now`. */
export function isPastRetention({ at, window, now }: { at: number; window: number; now: number }): boolean {
  return at < retentionCutoff({ window, now });
}

/** The design Order: Raw and Attachment Retention never longer than Event Retention; Report Retention at least Event Retention. */
export function isOrderedRetention(policy: RetentionPolicy): boolean {
  return policy.raw <= policy.event && policy.attachment <= policy.event && policy.report >= policy.event;
}

/** An Issue expires with its Events: last seen before Event Retention's cutoff, and holding no Report, which outlives them. */
export function isExpiredIssue({ lastSeen, reports, eventCutoff }: { lastSeen: number; reports: number; eventCutoff: number }): boolean {
  return lastSeen < eventCutoff && reports === 0;
}

// --- helpers ---

/** The earliest time still kept: anything before it is past retention. */
export function retentionCutoff({ window, now }: { window: number; now: number }): number {
  return now - window;
}
