/**
 * BlobStore -- the seam for payload and file storage (architecture Seams:
 * Payload and file storage). R2 in production, an in-memory fake in tests.
 * Keys are paths such as `events/<event id>`.
 */

export interface BlobStore {
  /** Removes the blob at a key; removing a missing key does nothing. */
  delete(key: string): Promise<void>;
}
