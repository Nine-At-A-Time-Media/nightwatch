// FakeMetricsSink -- MetricsSink that keeps every recorded Outcome.
import type { Outcome } from '../../src/domain/outcome/outcome.js';
import type { MetricsSink } from '../../src/ports/metrics-sink.js';

export class FakeMetricsSink implements MetricsSink {
  readonly recorded: Outcome[] = [];

  async record(outcomes: readonly Outcome[]): Promise<void> {
    this.recorded.push(...outcomes);
  }
}
