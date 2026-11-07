import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arrivalRecordId, needsBlob, rawBlobKey, storageAdvice } from '../../../../src/domain/ingest/admission.js';
import type { ItemFate } from '../../../../src/domain/ingest/items.js';

describe('arrivalRecordId', () => {
  it('names the receipt time and the unique part', () => {
    expect(arrivalRecordId({ receivedAt: 36, unique: 'abc' })).toBe('10-abc');
  });

  it('gives distinct ids for distinct unique parts at the same time', () => {
    fc.assert(
      fc.property(fc.nat(), fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (receivedAt, a, b) => {
        fc.pre(a !== b);
        expect(arrivalRecordId({ receivedAt, unique: a })).not.toBe(arrivalRecordId({ receivedAt, unique: b }));
      }),
    );
  });
});

const settings = { streamRecordLimit: 10, retryAdviceCeilingSeconds: 20, unavailableRetrySeconds: 30 };
const open = (type: string): ItemFate => ({ item: { header: { type }, payload: new Uint8Array() }, category: 'error', verdict: null });

describe('needsBlob', () => {
  it('sends a body over the stream record limit, an attachment arrival, or one keeping an attachment, to the BlobStore', () => {
    const small = new Uint8Array(10);
    expect(needsBlob({ endpoint: 'envelope', body: small, fates: [open('event')], settings })).toBe(false);
    expect(needsBlob({ endpoint: 'envelope', body: new Uint8Array(11), fates: [open('event')], settings })).toBe(true);
    expect(needsBlob({ endpoint: 'attachment', body: small, fates: [open('attachment')], settings })).toBe(true);
    expect(needsBlob({ endpoint: 'envelope', body: small, fates: [open('event'), open('attachment')], settings })).toBe(true);
    const dropped: ItemFate = { ...open('attachment'), verdict: { kind: 'invalid', reason: 'too-large' } };
    expect(needsBlob({ endpoint: 'envelope', body: small, fates: [open('event'), dropped], settings })).toBe(false);
  });
});

describe('rawBlobKey', () => {
  it('places the body under raw/, by Project and Arrival Record id', () => {
    expect(rawBlobKey({ projectId: '42', recordId: 'abc' })).toBe('raw/42/abc');
  });
});

describe('storageAdvice', () => {
  it('advises a retry only when storage failed retryably, never past the ceiling', () => {
    expect(storageAdvice({ storage: null, settings })).toEqual([]);
    expect(storageAdvice({ storage: { ok: true }, settings })).toEqual([]);
    expect(storageAdvice({ storage: { ok: false, retryable: false }, settings })).toEqual([]);
    expect(storageAdvice({ storage: { ok: false, retryable: true }, settings })).toEqual([
      { retryAfterSeconds: 20, categories: [], scope: 'project', reason: 'storage-unavailable' },
    ]);
  });
});
