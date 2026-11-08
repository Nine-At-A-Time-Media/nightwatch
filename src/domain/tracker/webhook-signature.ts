/**
 * Webhook signature header -- the shape of the signature a GitHub webhook
 * carries (design Security: forged GitHub webhooks). Only the parse lives
 * here: `sha256=` followed by a 32-byte digest in hex. Computing and
 * comparing the HMAC is the github adapter's, before any payload is parsed.
 */

import { refusal, type Refusal } from '../refusal.js';

export type WebhookSignature = { readonly algorithm: 'sha256'; readonly hex: string };

const SIGNATURE = /^sha256=([0-9a-fA-F]{64})$/;

// --- exports ---

/** The header's algorithm and lowercase hex digest, or a Refusal when it is missing or malformed. */
export function signatureHeaderValid(header: string | null): WebhookSignature | Refusal {
  const value = header?.trim() ?? '';
  if (value === '') return refusal('signature_missing');
  const match = SIGNATURE.exec(value);
  if (match?.[1] === undefined) return refusal('signature_malformed');
  return { algorithm: 'sha256', hex: match[1].toLowerCase() };
}
