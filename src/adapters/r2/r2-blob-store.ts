/**
 * R2BlobStore -- the BlobStore over an R2 bucket. A put that R2 accepted is
 * durable; a put that throws is reported as retryable, since R2 errors at
 * this boundary are transient (the bucket binding itself is checked at
 * deploy).
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { BlobStore } from '../../ports/blob-store.js';

export class R2BlobStore implements BlobStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async put(key: string, bytes: Uint8Array): Promise<Durability> {
    try {
      await this.#bucket.put(key, bytes);
      return { ok: true };
    } catch (error) {
      console.error(JSON.stringify({ event: 'blob-store.put-failed', key, error: String(error) }));
      return { ok: false, retryable: true };
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const object = await this.#bucket.get(key);
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.#bucket.delete(key);
  }
}
