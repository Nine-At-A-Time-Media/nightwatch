/**
 * Event tallies -- what an Issue reads from the Events it holds: which
 * Fingerprints hold an Event, the clock hour hourly counts are kept by, and
 * the windows an archive condition counts over. A Grouped Event is an Event
 * Summary with the Fingerprints it was grouped by; an IssueStore keeps one
 * per Event.
 */

import type { EventSummary } from '../event/event-summary.js';
import type { Fingerprint } from '../grouping/fingerprint.js';
import type { IssueState } from './state.js';

export type GroupedEvent = { readonly summary: EventSummary; readonly fingerprints: readonly Fingerprint[] };

/** The windows, in milliseconds, an Issue archived until a windowed condition counts over. */
export type ConditionWindows = { readonly window: number | null; readonly userWindow: number | null };

const HOUR = 3_600_000;
const NO_WINDOWS: ConditionWindows = { window: null, userWindow: null };

// --- predicates ---

/** An Event is held by a set of Fingerprints when it was grouped by any of them. */
export function isHeldBy(event: GroupedEvent, fingerprints: readonly Fingerprint[]): boolean {
  return event.fingerprints.some((fingerprint) => fingerprints.includes(fingerprint));
}

// --- helpers ---

/** The start of the clock hour holding `at`; hourly counts are kept per clock hour. */
export function hourStart(at: number): number {
  return Math.floor(at / HOUR) * HOUR;
}

export function conditionWindows(state: IssueState): ConditionWindows {
  if (state.status !== 'archived' || state.substatus !== 'until_condition') return NO_WINDOWS;
  return { window: state.condition.window, userWindow: state.condition.userWindow };
}

/** Where the condition windows of an Event at `at` start; null where the Issue counts over no window. */
export function conditionWindowStarts(state: IssueState, at: number): { events: number | null; users: number | null } {
  const { window, userWindow } = conditionWindows(state);
  return { events: window === null ? null : at - window, users: userWindow === null ? null : at - userWindow };
}
