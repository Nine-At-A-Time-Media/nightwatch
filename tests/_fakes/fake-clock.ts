// FakeClock -- a Clock that reads a settable time.
import type { Clock } from '../../src/ports/clock.js';

export class FakeClock implements Clock {
  constructor(public time: number) {}

  now(): number {
    return this.time;
  }
}
