/**
 * FakeMonitorStore -- an in-memory MonitorStore. Tests seed monitors with
 * `seed` and read the Failures recorded with `failuresOf`.
 */

import type { Failure } from '../../src/domain/monitor/monitor-state.js';
import type { Monitor, MonitorId } from '../../src/domain/monitor/monitor.js';
import type { MonitorStore } from '../../src/ports/monitor-store.js';

export class FakeMonitorStore implements MonitorStore {
  readonly #monitors = new Map<MonitorId, Monitor>();
  readonly #failures = new Map<MonitorId, Failure[]>();

  seed(monitor: Monitor): void {
    this.#monitors.set(monitor.monitorId, monitor);
  }

  failuresOf(monitorId: MonitorId): readonly Failure[] {
    return this.#failures.get(monitorId) ?? [];
  }

  async get(monitorId: MonitorId): Promise<Monitor | null> {
    return this.#monitors.get(monitorId) ?? null;
  }

  async put(monitor: Monitor): Promise<void> {
    this.#monitors.set(monitor.monitorId, monitor);
  }

  async recordFailures(monitorId: MonitorId, failures: readonly Failure[]): Promise<void> {
    this.#failures.set(monitorId, [...this.failuresOf(monitorId), ...failures]);
  }
}
