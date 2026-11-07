// WaeMetricsSink -- each Outcome becomes one Analytics Engine data point,
// indexed by Project, with its kind, reason and category as blobs and its
// quantity as the double. NoMetricsSink, the local choice when the binding
// is absent, accepts Outcomes and keeps nothing.
import { describe, expect, it } from 'vitest';
import { NoMetricsSink, WaeMetricsSink } from '../../../../src/adapters/wae/wae-metrics-sink.js';
import type { Outcome } from '../../../../src/domain/outcome/outcome.js';

class RecordingDataset {
  readonly points: unknown[] = [];

  writeDataPoint(point: unknown): void {
    this.points.push(point);
  }
}

const outcomes: Outcome[] = [
  { projectId: '42', recordedAt: 1, kind: 'accepted', reason: null, category: 'error', quantity: 1 },
  { projectId: '42', recordedAt: 1, kind: 'filtered', reason: 'localhost', category: 'error', quantity: 3 },
];

describe('WaeMetricsSink', () => {
  it('writes one data point per Outcome, a null reason as an empty blob', async () => {
    const dataset = new RecordingDataset();
    await new WaeMetricsSink(dataset).record(outcomes);
    expect(dataset.points).toEqual([
      { indexes: ['42'], blobs: ['accepted', '', 'error'], doubles: [1] },
      { indexes: ['42'], blobs: ['filtered', 'localhost', 'error'], doubles: [3] },
    ]);
  });
});

describe('NoMetricsSink', () => {
  it('accepts Outcomes without failing', async () => {
    await expect(new NoMetricsSink().record(outcomes)).resolves.toBeUndefined();
  });
});
