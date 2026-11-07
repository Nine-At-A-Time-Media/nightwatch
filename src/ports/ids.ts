/**
 * Ids -- the seam for randomness and Report Reference hashing (architecture
 * Seams: Randomness and reference hashing; Mechanism, Reports). Web Crypto in
 * production, a seeded fake in tests. A Report Reference is minted from
 * `randomBytes` by the report domain and kept at rest only as its hash.
 * Processing hashes the values a Scrubbing Rule hashes, and user keys.
 */

import type { ReportReference } from '../domain/report/reference.js';

export interface Ids {
  /** A new identifier, never issued before. */
  newId(): string;
  /** `count` bytes from a cryptographic random source. */
  randomBytes(count: number): Uint8Array;
  /** The hash a Report Reference is kept under at rest; the same reference always hashes the same. */
  hashReference(reference: ReportReference): Promise<string>;

  // --- task-008: hashing scrubbed values and user keys ---

  /** The hash a Scrubbing Rule's `hash` method, and an Event's user key, keep in place of a text; the same text always hashes the same. */
  hash(text: string): Promise<string>;
}
