/**
 * FakeIncidentStore -- an in-memory IncidentStore, one state per rule.
 */

import type { IncidentState } from '../../src/domain/alerts/metric-incident.js';
import type { IncidentStore } from '../../src/ports/incident-store.js';

export class FakeIncidentStore implements IncidentStore {
  readonly states = new Map<string, IncidentState>();

  async get(ruleId: string): Promise<IncidentState | null> {
    return this.states.get(ruleId) ?? null;
  }

  async put(ruleId: string, state: IncidentState): Promise<void> {
    this.states.set(ruleId, state);
  }
}
