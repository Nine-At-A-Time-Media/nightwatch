/**
 * IncidentStore -- where one Metric Alert Rule's Incident state lives
 * between evaluations (architecture Mechanism: MetricRuleDO counts
 * consecutive breaches and changes the Incident). MetricRuleDO storage in
 * production, an in-memory fake in tests. A rule never evaluated has no
 * state.
 */

import type { IncidentState } from '../domain/alerts/metric-incident.js';

export interface IncidentStore {
  get(ruleId: string): Promise<IncidentState | null>;
  put(ruleId: string, state: IncidentState): Promise<void>;
}
