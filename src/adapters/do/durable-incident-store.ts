/**
 * DurableIncidentStore -- IncidentStore over one MetricRuleDO's own storage
 * (architecture Mechanism: MetricRuleDO counts consecutive breaches and
 * changes the Incident). One key per rule; the object holds one rule.
 */

import type { IncidentState } from '../../domain/alerts/metric-incident.js';
import type { IncidentStore } from '../../ports/incident-store.js';

const INCIDENT_PREFIX = 'incident:';

// --- exports ---

export class DurableIncidentStore implements IncidentStore {
  readonly #storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
  }

  async get(ruleId: string): Promise<IncidentState | null> {
    return (await this.#storage.get<IncidentState>(`${INCIDENT_PREFIX}${ruleId}`)) ?? null;
  }

  async put(ruleId: string, state: IncidentState): Promise<void> {
    await this.#storage.put(`${INCIDENT_PREFIX}${ruleId}`, state);
  }
}
