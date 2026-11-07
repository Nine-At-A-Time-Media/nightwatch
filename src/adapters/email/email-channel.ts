/**
 * EmailChannel -- the Channel for email Destinations, sent through the
 * Mailer port (architecture Seams: Alert channel, Outbound mail). The
 * composition root hands it whichever Mailer it built; the Mailer's
 * Durability is the delivery's.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { AlertMessage, Channel, Destination } from '../../ports/channel.js';
import type { Mailer } from '../../ports/mailer.js';

const REFUSED: Durability = { ok: false, retryable: false };

// --- exports ---

export class EmailChannel implements Channel {
  readonly kind = 'email';
  readonly #mailer: Mailer;

  constructor(mailer: Mailer) {
    this.#mailer = mailer;
  }

  async deliver(destination: Destination, message: AlertMessage): Promise<Durability> {
    if (destination.kind !== 'email') return REFUSED;
    return this.#mailer.send({ to: destination.address, subject: message.subject, text: message.text, headers: {} });
  }
}
