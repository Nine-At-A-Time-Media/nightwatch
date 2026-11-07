/**
 * SendEmailMailer -- the Mailer over the Workers Email Sending `send_email`
 * binding (architecture Seams: Outbound mail). Every message goes from the
 * one sender address the composition root configures. On the local stage
 * Wrangler carries the binding itself and writes each message as an `.eml`
 * file instead of sending it (architecture, Local development). A send the
 * binding throws on is reported retryable: the binding does not say whether
 * a later try could succeed.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { Mailer, MailMessage } from '../../ports/mailer.js';

/** The message as the binding takes it: composed fields, no raw MIME. */
export type SentEmail = {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** The part of the `send_email` binding this adapter uses; the Workers binding satisfies it. */
export interface SendEmailBinding {
  send(message: SentEmail): Promise<unknown>;
}

const FAILED: Durability = { ok: false, retryable: true };

// --- helpers ---

function sentEmail({ message, from }: { message: MailMessage; from: string }): SentEmail {
  const { to, subject, text, headers } = message;
  return message.html === undefined ? { from, to, subject, text, headers } : { from, to, subject, text, html: message.html, headers };
}

// --- exports ---

export class SendEmailMailer implements Mailer {
  readonly #binding: SendEmailBinding;
  readonly #from: string;

  constructor({ binding, from }: { binding: SendEmailBinding; from: string }) {
    this.#binding = binding;
    this.#from = from;
  }

  async send(message: MailMessage): Promise<Durability> {
    try {
      await this.#binding.send(sentEmail({ message, from: this.#from }));
      return { ok: true };
    } catch (error) {
      console.error(JSON.stringify({ event: 'mailer.send-failed', error: String(error) }));
      return FAILED;
    }
  }
}
