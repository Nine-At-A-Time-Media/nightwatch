/**
 * Fingerprint -- a stable identifier derived from an Event under a Grouping
 * Version (design Domain Language): 32 lowercase hex characters, the 128-bit
 * FNV-1a hash of a canonical serialization of what contributed to it.
 *
 * FNV-1a is NOT cryptographic. A Fingerprint only has to be stable and well
 * spread; nobody gains by forging one, since a sender can already name its
 * own fingerprint. It is pure and synchronous, so derivation needs no port.
 */

export type Fingerprint = string;

/** What a Fingerprint is computed over: strings and nested lists of them. */
export type CanonicalValue = string | readonly CanonicalValue[];

const FNV_OFFSET_BASIS = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const MASK_128 = (1n << 128n) - 1n;
const HEX_LENGTH = 32;
const UTF8 = new TextEncoder();

// --- exports ---

/** The 128-bit FNV-1a hash of the UTF-8 bytes of text, as 32 hex characters. */
export function fnv1a128(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of UTF8.encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_128;
  }
  return hash.toString(16).padStart(HEX_LENGTH, '0');
}

/** The Fingerprint of a canonical value; JSON keeps list structure, so ['a','b'] and ['ab'] differ. */
export function fingerprintOf(parts: CanonicalValue): Fingerprint {
  return fnv1a128(JSON.stringify(parts));
}
