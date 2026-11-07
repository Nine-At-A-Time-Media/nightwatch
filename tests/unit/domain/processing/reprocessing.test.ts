import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ArrivalRecord } from '../../../../src/domain/ingest/arrival.js';
import {
  isPastRange,
  isRawExpired,
  isReprocessed,
  reprocessingSubscription,
} from '../../../../src/domain/processing/reprocessing.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);
const range = { start: T0, end: T0 + DAY };

function record(projectId: string, receivedAt: number): ArrivalRecord {
  return { id: 'rec', projectId, receivedAt, endpoint: 'envelope', assertion: null, body: new Uint8Array(), blobKey: null };
}

describe('reprocessing', () => {
  it('reprocesses only the Project\'s records received within the range, by their server time', () => {
    expect(isReprocessed(record('web', T0), { projectId: 'web', range })).toBe(true);
    expect(isReprocessed(record('web', T0 + DAY), { projectId: 'web', range })).toBe(false);
    expect(isReprocessed(record('api', T0), { projectId: 'web', range })).toBe(false);
    expect(isPastRange(record('api', T0 + DAY), range)).toBe(true);
    expect(isPastRange(record('web', T0 + DAY - 1), range)).toBe(false);
  });

  it('a range whose start is older than Raw Retention has expired', () => {
    expect(isRawExpired({ range, now: T0 + 7 * DAY, rawRetention: 7 * DAY })).toBe(false);
    expect(isRawExpired({ range, now: T0 + 7 * DAY + 1, rawRetention: 7 * DAY })).toBe(true);
  });

  it('names one subscription per Project and range, so a rerun resumes it and other ranges never share it', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), fc.nat(), fc.string(), fc.nat(), fc.nat(), (p1, s1, e1, p2, s2, e2) => {
        const a = reprocessingSubscription({ projectId: p1, range: { start: s1, end: e1 } });
        const b = reprocessingSubscription({ projectId: p2, range: { start: s2, end: e2 } });
        expect(a === b).toBe(p1 === p2 && s1 === s2 && e1 === e2);
      }),
    );
  });
});
