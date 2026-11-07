/**
 * MetricsSink -- the seam for live, possibly sampled, metrics over Outcomes.
 */

import type { Outcome } from '../domain/outcome/outcome.js';

export interface MetricsSink {
  record(outcomes: readonly Outcome[]): Promise<void>;
}
