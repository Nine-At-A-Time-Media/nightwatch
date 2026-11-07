/**
 * SendEmailMailer -- the Mailer over Cloudflare Email Sending's `send_email`
 * binding (architecture Seams: Outbound mail). It composes each message with
 * the binding's structured builder, from the one sender address the
 * composition root reads from settings. A send the binding rejects is not
 * ok, and retryable: the binding does not say which failures would pass on
 * a later try. On the local stage the binding writes each message to a file.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { MailMessage, Mailer } from '../../ports/mailer.js';

/** The part of the `send_email` binding this adapter uses; the binding itself satisfies it. */
export interface MailBinding {
  send(builder: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    headers: Record<string, string>;
  }): Promise<unknown>;
}

const SENT: Durability = { ok: true };
const NOT_SENT: Durability = { ok: false, retryable: true };

// --- exports ---

export class SendEmailMailer implements Mailer {
  readonly #binding: MailBinding;
  readonly #from: string;

  constructor(options: { binding: MailBinding; from: string }) {
    this.#binding = options.binding;
    this.#from = options.from;
  }

  async send(message: MailMessage): Promise<Durability> {
    const { to, subject, text, html, headers } = message;
    try {
      await this.#binding.send({ from: this.#from, to, subject, text, ...(html === undefined ? {} : { html }), headers: { ...headers } });
      return SENT;
    } catch {
      return NOT_SENT;
    }
  }
}
