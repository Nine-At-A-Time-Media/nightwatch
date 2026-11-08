/**
 * Clock drift -- corrects an Event's times for the sender's clock (design
 * Processing, Clock drift). When the sender stamped when it sent, every
 * time shifts by the gap between receipt and that stamp. A time still past
 * the Clock-drift clamp is clamped to receipt. An Event older than the Event
 * Retention window is refused. Times are epoch milliseconds.
 */

export type ClockDrift = {
  readonly receivedAt: number;
  /** When the sender says it sent, by its own clock; null when it did not say. */
  readonly sentAt: number | null;
  /** The future skew tolerated before a time is clamped (Parameters, Clock-drift clamp). */
  readonly clampFutureMs: number;
  readonly retentionMs: number;
};

export type CorrectedTime = { readonly time: number; readonly clamped: boolean };

// --- predicates ---

function isBeyondClamp(time: number, drift: ClockDrift): boolean {
  return time > drift.receivedAt + drift.clampFutureMs;
}

/** True when a corrected time falls outside the Event Retention window. */
export function isTooOld(time: number, drift: ClockDrift): boolean {
  return drift.receivedAt - time > drift.retentionMs;
}

// --- exports ---

/** Shifts a time sent by the sender into receipt time, then clamps it if it is still too far in the future. */
export function correctTime(time: number, drift: ClockDrift): CorrectedTime {
  const shifted = drift.sentAt === null ? time : time + (drift.receivedAt - drift.sentAt);
  return isBeyondClamp(shifted, drift) ? { time: drift.receivedAt, clamped: true } : { time: shifted, clamped: false };
}
