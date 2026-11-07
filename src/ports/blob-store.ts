/**
 * BlobStore -- the seam for payload and file storage (architecture Seams:
 * Payload and file storage). R2 in production, an in-memory fake in tests.
 * Keys are paths such as `events/<event id>`. A put that reports ok is
 * durable; get answers null for a missing key.
 */

import type { Durability } from '../domain/ingest/arrival.js';

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<Durability>;
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the blob at a key; removing a missing key does nothing. */
  delete(key: string): Promise<void>;
}
