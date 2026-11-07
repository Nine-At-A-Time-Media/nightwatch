/**
 * FakeBlobStore -- an in-memory BlobStore. Tests seed blobs with `put`.
 */

import type { BlobStore } from '../../src/ports/blob-store.js';

export class FakeBlobStore implements BlobStore {
  readonly blobs = new Map<string, string>();

  put(key: string, body: string): void {
    this.blobs.set(key, body);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}
