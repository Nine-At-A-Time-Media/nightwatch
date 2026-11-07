/**
 * Clock -- the seam for time. `now` is epoch milliseconds.
 */

export interface Clock {
  now(): number;
}
