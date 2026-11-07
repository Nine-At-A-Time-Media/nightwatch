/**
 * Ids -- the seam for randomness and Report Reference hashing (architecture
 * Seams: Randomness and reference hashing; Mechanism, Reports). Web Crypto in
 * production, a seeded fake in tests. A Report Reference is minted from
 * `randomBytes` by the report domain and kept at rest only as its hash.
 */

import type { ReportReference } from '../domain/report/reference.js';

export interface Ids {
  /** A new identifier, never issued before. */
  newId(): string;
  /** `count` bytes from a cryptographic random source. */
  randomBytes(count: number): Uint8Array;
  /** The hash a Report Reference is kept under at rest; the same reference always hashes the same. */
  hashReference(reference: ReportReference): Promise<string>;

  // --- task-022: content hashing (Artifact keys, Access Token hashes) ---

  /** A hash of the bytes in lowercase hex; equal bytes always hash the same, different bytes apart. */
  hashContent(bytes: Uint8Array): Promise<string>;
}
