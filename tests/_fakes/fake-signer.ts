/**
 * FakeSigner -- a Signer that keys two FNV-1a hashes of the text with a
 * secret and writes them in hex: stable, distinct per text in practice, and
 * no use as real cryptography.
 */

import type { Signer } from '../../src/ports/signer.js';

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class FakeSigner implements Signer {
  readonly #secret: string;

  constructor(secret = 'secret') {
    this.#secret = secret;
  }

  async sign(text: string): Promise<string> {
    const keyed = `${this.#secret}\u0000${text}`;
    return `${fnv1a(keyed, 0x811c9dc5)}${fnv1a(keyed, 0x01234567)}`;
  }

  async verify(signed: { text: string; signature: string }): Promise<boolean> {
    return (await this.sign(signed.text)) === signed.signature;
  }
}
