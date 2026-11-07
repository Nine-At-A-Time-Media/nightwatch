/**
 * Clock -- the seam for time (architecture Seams: Time). The system clock in
 * production, a fake clock in tests.
 */

export interface Clock {
  /** The current time in epoch milliseconds. */
  now(): number;
}
