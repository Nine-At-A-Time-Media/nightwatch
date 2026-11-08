// FakeBlobStore -- BlobStore over an in-memory map, or failing when told to.
import type { Durability } from '../../src/domain/ingest/arrival.js';
import type { BlobStore } from '../../src/ports/blob-store.js';

export class FakeBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();
  failure: { retryable: boolean } | null = null;

  async put(key: string, bytes: Uint8Array): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.blobs.set(key, bytes);
    return { ok: true };
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.blobs.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}
