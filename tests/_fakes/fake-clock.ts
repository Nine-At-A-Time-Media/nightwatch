/**
 * FakeClock -- a Clock that stands still until a test moves it.
 */

import type { Clock } from '../../src/ports/clock.js';

export class FakeClock implements Clock {
  #now: number;

  constructor(start: number) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  set(at: number): void {
    this.#now = at;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}
