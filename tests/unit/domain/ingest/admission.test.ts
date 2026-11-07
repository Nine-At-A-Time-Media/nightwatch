import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arrivalRecordId, needsBlob, rawBlobKey, storageAdvice } from '../../../../src/domain/ingest/admission.js';
import type { ItemFate } from '../../../../src/domain/ingest/items.js';

describe('arrivalRecordId', () => {
  it('is the same for the same Project, time and body', async () => {
    const body = new TextEncoder().encode('{}');
    const a = await arrivalRecordId({ projectId: '1', receivedAt: 5, body });
    const b = await arrivalRecordId({ projectId: '1', receivedAt: 5, body });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-f]{32}$/);
  });

  it('differs when the Project, the time or the body differs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 32 }), fc.uint8Array({ maxLength: 32 }), async (x, y) => {
        const base = await arrivalRecordId({ projectId: '1', receivedAt: 5, body: x });
        expect(await arrivalRecordId({ projectId: '2', receivedAt: 5, body: x })).not.toBe(base);
        expect(await arrivalRecordId({ projectId: '1', receivedAt: 6, body: x })).not.toBe(base);
        const other = await arrivalRecordId({ projectId: '1', receivedAt: 5, body: y });
        expect(other === base).toBe(x.length === y.length && x.every((v, i) => v === y[i]));
      }),
      { numRuns: 50 },
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
