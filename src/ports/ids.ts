/**
 * Ids -- the seam for randomness (architecture Seams: Randomness). Web Crypto
 * in production, a seeded fake in tests.
 */

export interface Ids {
  /** A new identifier, never issued before. */
  newId(): string;
}
