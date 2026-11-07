/**
 * BlobStore -- the seam for payload and file storage. A put that reports ok
 * is durable; get answers null for a missing key.
 */

import type { Durability } from '../domain/ingest/arrival.js';

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<Durability>;
  get(key: string): Promise<Uint8Array | null>;
}
