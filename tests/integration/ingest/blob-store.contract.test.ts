// BlobStore contract: the R2 adapter and the in-memory fake keep the same
// promises -- a durable put reads back byte for byte, a later put replaces,
// and a missing key reads as null.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { R2BlobStore } from '../../../src/adapters/r2/r2-blob-store.js';
import type { BlobStore } from '../../../src/ports/blob-store.js';
import { FakeBlobStore } from '../../_fakes/fake-blob-store.js';

const bytes = (...values: number[]) => new Uint8Array(values);

describe.each<{ name: string; make: () => BlobStore }>([
  { name: 'FakeBlobStore', make: () => new FakeBlobStore() },
  { name: 'R2BlobStore', make: () => new R2BlobStore(env.BLOBS) },
])('BlobStore contract -- $name', ({ make }) => {
  let store: BlobStore;
  let key: string;

  beforeEach(() => {
    store = make();
    key = `raw/contract/${crypto.randomUUID()}`;
  });

  it('a durable put reads back the same bytes', async () => {
    expect(await store.put(key, bytes(0, 1, 2, 255, 10))).toEqual({ ok: true });
    expect(await store.get(key)).toEqual(bytes(0, 1, 2, 255, 10));
  });

  it('a second put to the same key replaces the first', async () => {
    await store.put(key, bytes(1, 2, 3));
    await store.put(key, bytes(9));
    expect(await store.get(key)).toEqual(bytes(9));
  });

  it('a key never put reads as null', async () => {
    expect(await store.get(key)).toBeNull();
  });

  it('an empty body is stored and read back empty, not as missing', async () => {
    await store.put(key, bytes());
    expect(await store.get(key)).toEqual(bytes());
  });
});
