import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arrivalRecordId } from '../../../../src/domain/ingest/admission.js';

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
