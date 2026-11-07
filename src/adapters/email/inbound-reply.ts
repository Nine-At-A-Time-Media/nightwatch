/**
 * Inbound replies -- the email adapter's MIME parse of a reply Email Routing
 * delivers to the inbound-mail Worker (architecture Mechanism, Alerts and
 * notifications), through postal-mime.
 *
 * The Inbound Reply names the address the mail was delivered to (where the
 * Reply Token is), the address in its From header, and its plain text. The
 * mail's own authentication is checked here, before any use case sees it
 * (design Security: a claimed sender alone is not authentication): the
 * topmost Authentication-Results header, the one the receiving server added,
 * must report DMARC passed for the From domain; any header below it could
 * have been written by the sender. Anything else is refused as
 * unauthenticated. A message that cannot be parsed or names no sender is
 * refused as unreadable. Verifying the token and matching the sender to the Member is
 * applyEmailReply's.
 */

import PostalMime, { type Email } from 'postal-mime';
import type { InboundReply } from '../../domain/mail/reply-address.js';
import { refusal, type Refusal } from '../../domain/refusal.js';

const AUTHENTICATION_RESULTS = 'authentication-results';
const DMARC_PASS = /(?:^|[;\s])dmarc=pass\b/i;

// --- predicates ---

function isAuthenticated(email: Email): boolean {
  const receiving = email.headers.find((header) => header.key === AUTHENTICATION_RESULTS);
  return receiving !== undefined && DMARC_PASS.test(receiving.value);
}

// --- helpers ---

function senderOf(email: Email): string | null {
  const address = email.from?.address;
  return address === undefined || address === '' ? null : address;
}

async function parsed(raw: Uint8Array | ReadableStream<Uint8Array>): Promise<Email | null> {
  try {
    return await PostalMime.parse(raw);
  } catch {
    return null;
  }
}

// --- exports ---

/** The Inbound Reply a delivered message carries, or a Refusal naming why it is not one. */
export async function inboundReplyOf(delivered: {
  to: string;
  raw: Uint8Array | ReadableStream<Uint8Array>;
}): Promise<InboundReply | Refusal> {
  const email = await parsed(delivered.raw);
  if (email === null) return refusal('mail_unreadable');
  if (!isAuthenticated(email)) return refusal('mail_unauthenticated');
  const from = senderOf(email);
  if (from === null) return refusal('mail_unreadable');
  return { to: delivered.to, from, text: email.text ?? '' };
}
