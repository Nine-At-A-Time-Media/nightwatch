/**
 * MetricsSink adapters. WaeMetricsSink writes each Outcome as one Analytics
 * Engine data point, indexed by Project (sampled and live; architecture,
 * Mechanism: Ingest). NoMetricsSink is the choice when no dataset is bound,
 * as on the local stage, where live charts are empty by design.
 */

import type { Outcome } from '../../domain/outcome/outcome.js';
import type { MetricsSink } from '../../ports/metrics-sink.js';

// --- helpers ---

function dataPointOf(outcome: Outcome): AnalyticsEngineDataPoint {
  return { indexes: [outcome.projectId], blobs: [outcome.kind, outcome.reason ?? '', outcome.category], doubles: [outcome.quantity] };
}

// --- exports ---

export class WaeMetricsSink implements MetricsSink {
  readonly #dataset: AnalyticsEngineDataset;

  constructor(dataset: AnalyticsEngineDataset) {
    this.#dataset = dataset;
  }

  async record(outcomes: readonly Outcome[]): Promise<void> {
    for (const outcome of outcomes) this.#dataset.writeDataPoint(dataPointOf(outcome));
  }
}

export class NoMetricsSink implements MetricsSink {
  async record(outcomes: readonly Outcome[]): Promise<void> {
    void outcomes;
  }
}
