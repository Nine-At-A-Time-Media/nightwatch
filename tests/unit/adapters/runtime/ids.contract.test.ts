// Ids contract: the fake and the Web Crypto adapter agree on what minting a
// Report Reference needs -- random bytes of the asked length, and a hash
// that is stable for one reference, differs between references, and never
// contains the reference itself.
import { describe, expect, it } from 'vitest';
import { RandomIds } from '../../../../src/adapters/runtime/random-ids.js';
import { encodeReference, REFERENCE_BYTES } from '../../../../src/domain/report/reference.js';
import type { Ids } from '../../../../src/ports/ids.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';

describe.each<{ name: string; make: () => Ids }>([
  { name: 'FakeIds', make: () => new FakeIds() },
  { name: 'RandomIds', make: () => new RandomIds() },
])('Ids contract -- $name', ({ make }) => {
  it('gives random bytes of the asked length, different each time', () => {
    const ids = make();
    const first = ids.randomBytes(REFERENCE_BYTES);
    const second = ids.randomBytes(REFERENCE_BYTES);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(REFERENCE_BYTES);
    expect(first).not.toEqual(second);
  });

  it('hashes a Report Reference stably, apart from other references, and without the reference in it', async () => {
    const ids = make();
    const reference = encodeReference(ids.randomBytes(REFERENCE_BYTES)) ?? '';
    const other = encodeReference(ids.randomBytes(REFERENCE_BYTES)) ?? '';
    const hash = await ids.hashReference(reference);
    expect(await ids.hashReference(reference)).toBe(hash);
    expect(await ids.hashReference(other)).not.toBe(hash);
    expect(hash).not.toContain(reference);
  });

  it('hashes content stably and apart from other content', async () => {
    const ids = make();
    const content = new Uint8Array([1, 2, 3]);
    const hash = await ids.hashContent(content);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(await ids.hashContent(new Uint8Array([1, 2, 3]))).toBe(hash);
    expect(await ids.hashContent(new Uint8Array([3, 2, 1]))).not.toBe(hash);
    expect(await ids.hashContent(new Uint8Array([1, 2, 3, 0]))).not.toBe(hash);
  });
});

describe('RandomIds', () => {
  it('hashes with SHA-256, written in hex', async () => {
    expect(await new RandomIds().hashReference('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes content with SHA-256, written in hex', async () => {
    expect(await new RandomIds().hashContent(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
