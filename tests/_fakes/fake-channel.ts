/**
 * FakeChannel -- a Channel of one kind that keeps every delivery, or fails
 * when told to. `failures` fails only the next n attempts, then delivers.
 */

import type { Durability } from '../../src/domain/ingest/arrival.js';
import type { AlertMessage, Channel, ChannelKind, Destination } from '../../src/ports/channel.js';

export class FakeChannel implements Channel {
  readonly kind: ChannelKind;
  readonly delivered: { destination: Destination; message: AlertMessage }[] = [];
  /** Every attempt, delivered or not. */
  readonly attempts: { destination: Destination; message: AlertMessage }[] = [];
  failure: { retryable: boolean } | null = null;
  failures = 0;

  constructor(kind: ChannelKind) {
    this.kind = kind;
  }

  async deliver(destination: Destination, message: AlertMessage): Promise<Durability> {
    if (destination.kind !== this.kind) return { ok: false, retryable: false };
    this.attempts.push({ destination, message });
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    if (this.failures > 0) {
      this.failures -= 1;
      return { ok: false, retryable: true };
    }
    this.delivered.push({ destination, message });
    return { ok: true };
  }
}
