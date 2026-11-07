/**
 * SendEmailMailer -- the Mailer over the Email Sending `send_email` binding
 * (architecture Seams: Outbound mail; Mechanism, Alerts and notifications).
 * Every message goes out from the notifier's own address. A Reply-To header
 * moves into the binding's `replyTo` field; the rest, such as the thread
 * headers, pass through as headers. On the local stage the binding writes
 * each message as a file instead of sending it. A send the binding refuses
 * may succeed later, so it is a retryable failure.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { Mailer, MailMessage } from '../../ports/mailer.js';

const REPLY_TO = 'reply-to';

// --- helpers ---

function replyToOf(headers: Readonly<Record<string, string>>): string | undefined {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === REPLY_TO)?.[1];
}

function withoutReplyTo(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== REPLY_TO));
}

function builderOf(message: MailMessage, from: string): EmailMessageBuilder {
  const replyTo = replyToOf(message.headers);
  return {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html === undefined ? {} : { html: message.html }),
    ...(replyTo === undefined ? {} : { replyTo }),
    headers: withoutReplyTo(message.headers),
  };
}

// --- adapter ---

export class SendEmailMailer implements Mailer {
  readonly #binding: SendEmail;
  readonly #from: string;

  constructor({ binding, from }: { binding: SendEmail; from: string }) {
    this.#binding = binding;
    this.#from = from;
  }

  async send(message: MailMessage): Promise<Durability> {
    try {
      await this.#binding.send(builderOf(message, this.#from));
      return { ok: true };
    } catch {
      return { ok: false, retryable: true };
    }
  }
}
