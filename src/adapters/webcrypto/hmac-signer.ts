/**
 * HmacSigner -- the Signer over Web Crypto: HMAC-SHA-256 under a secret the
 * composition root reads from a Worker secret, written as unpadded
 * base64url. Verification is Web Crypto's own, which compares in constant
 * time.
 */

import type { Signer } from '../../ports/signer.js';

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

// --- helpers ---

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// --- exports ---

export class HmacSigner implements Signer {
  readonly #key: Promise<CryptoKey>;

  constructor(secret: string) {
    this.#key = crypto.subtle.importKey('raw', bytesOf(secret), ALGORITHM, false, ['sign', 'verify']);
  }

  async sign(text: string): Promise<string> {
    return base64url(await crypto.subtle.sign(ALGORITHM.name, await this.#key, bytesOf(text)));
  }

  async verify(signed: { text: string; signature: string }): Promise<boolean> {
    const signature = fromBase64url(signed.signature);
    if (signature === null) return false;
    return crypto.subtle.verify(ALGORITHM.name, await this.#key, signature, bytesOf(signed.text));
  }
}
