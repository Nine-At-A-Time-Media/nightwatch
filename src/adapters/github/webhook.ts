/**
 * Webhook verification -- proves a GitHub webhook came from GitHub before any
 * of it is parsed (design Security: forged GitHub webhooks; architecture
 * Mechanism, Code and GitHub). The signature header's shape is the domain's
 * `signatureHeaderValid`; here the HMAC-SHA256 of the exact body bytes under
 * the shared secret is checked with Web Crypto's verify, which compares in
 * constant time. An unset secret refuses everything.
 */

import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import { signatureHeaderValid } from '../../domain/tracker/webhook-signature.js';

export type Verified = { readonly verified: true };

const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

// --- helpers ---

function bytesOfHex(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function bytesOf(body: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
}

// --- exports ---

/** Whether `body` carries a valid signature under `secret`; a Refusal names why not. */
export async function verifyWebhook(
  secret: string,
  body: string | Uint8Array,
  signatureHeader: string | null,
): Promise<Verified | Refusal> {
  const signature = signatureHeaderValid(signatureHeader);
  if (isRefusal(signature)) return signature;
  if (secret === '') return refusal('secret_missing');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), HMAC, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, bytesOfHex(signature.hex), bytesOf(body));
  return valid ? { verified: true } : refusal('signature_mismatch');
}
