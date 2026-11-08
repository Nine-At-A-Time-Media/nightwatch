/**
 * SystemClock -- the Clock over the runtime's wall clock.
 */

import type { Clock } from '../../ports/clock.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
