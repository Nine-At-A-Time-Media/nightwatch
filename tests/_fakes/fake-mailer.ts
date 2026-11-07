// FakeMailer -- Mailer that keeps every message sent, or fails when told to.
import type { Durability } from '../../src/domain/ingest/arrival.js';
import type { Mailer, MailMessage } from '../../src/ports/mailer.js';

export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failure: { retryable: boolean } | null = null;

  async send(message: MailMessage): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.sent.push(message);
    return { ok: true };
  }

  /** The messages sent to one address. */
  sentTo(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
