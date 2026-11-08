/**
 * Mailer -- the seam for outbound mail (architecture Seams: Outbound mail).
 * The Email Sending binding in production, an in-memory fake in tests. A
 * send that reports ok was accepted for delivery.
 */

import type { Durability } from '../domain/ingest/arrival.js';

export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers: Readonly<Record<string, string>>;
};

export interface Mailer {
  send(message: MailMessage): Promise<Durability>;
}
