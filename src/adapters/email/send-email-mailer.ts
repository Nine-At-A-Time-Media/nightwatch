/**
 * SendEmailMailer -- the Mailer over Cloudflare Email Sending's `send_email`
 * binding (architecture Seams: Outbound mail; Mechanism, Alerts and
 * notifications). It composes each message with the binding's structured
 * builder, from the one sender address the composition root reads from
 * settings. A Reply-To header moves into the builder's `replyTo` field; the
 * rest, such as the thread headers, pass through as headers. A send the
 * binding rejects is not ok, and retryable: the binding does not say which
 * failures would pass on a later try. On the local stage the binding writes
 * each message to a file.
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
    replyTo?: string;
    headers: Record<string, string>;
  }): Promise<unknown>;
}

const SENT: Durability = { ok: true };
const NOT_SENT: Durability = { ok: false, retryable: true };
const REPLY_TO = 'reply-to';

// --- helpers ---

function replyToOf(headers: Readonly<Record<string, string>>): string | undefined {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === REPLY_TO)?.[1];
}

function withoutReplyTo(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== REPLY_TO));
}

function builderOf(message: MailMessage, from: string): Parameters<MailBinding['send']>[0] {
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

// --- exports ---

export class SendEmailMailer implements Mailer {
  readonly #binding: MailBinding;
  readonly #from: string;

  constructor(options: { binding: MailBinding; from: string }) {
    this.#binding = options.binding;
    this.#from = options.from;
  }

  async send(message: MailMessage): Promise<Durability> {
    try {
      await this.#binding.send(builderOf(message, this.#from));
      return SENT;
    } catch {
      return NOT_SENT;
    }
  }
}
