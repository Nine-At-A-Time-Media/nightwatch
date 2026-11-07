/**
 * Report Reference -- the handle a Reporter uses to follow a Report (design
 * Reports, Reference; Security Considerations, A leaked Report Reference).
 * A reference is 128 random bits written in URL-safe base64 without
 * padding: 22 characters, the last of which carries only two bits.
 *
 * The domain owns the shape only. The random bytes come from the `Ids` port
 * and the hash kept at rest is computed at the use-case layer, so nothing
 * here draws randomness or hashes.
 */

/** A Report Reference as given to a Reporter. */
export type ReportReference = string;

export const REFERENCE_BYTES = 16;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** 22 characters hold 132 bits; the last character's low four bits are padding and must be zero. */
const WELL_FORMED = /^[A-Za-z0-9_-]{21}[AQgw]$/;

// --- predicates ---

/** True when `text` is the canonical encoding of some 128 bits. */
export function isWellFormedReference(text: string): boolean {
  return WELL_FORMED.test(text);
}

// --- helpers ---

function symbol(index: number): string {
  return ALPHABET.charAt(index & 63);
}

/** Encodes up to three bytes as up to four characters, dropping padding. */
function encodeGroup(bytes: Uint8Array, start: number): string {
  const count = Math.min(3, bytes.length - start);
  const word = ((bytes[start] ?? 0) << 16) | ((bytes[start + 1] ?? 0) << 8) | (bytes[start + 2] ?? 0);
  const chars = [symbol(word >> 18), symbol(word >> 12), symbol(word >> 6), symbol(word)];
  return chars.slice(0, count + 1).join('');
}

// --- exports ---

/** The Report Reference for 128 random bits, or null when not given exactly 128 bits. */
export function encodeReference(bytes: Uint8Array): ReportReference | null {
  if (bytes.length !== REFERENCE_BYTES) return null;
  const groups: string[] = [];
  for (let start = 0; start < bytes.length; start += 3) groups.push(encodeGroup(bytes, start));
  return groups.join('');
}
