/**
 * DurableMonitorStore -- MonitorStore over one MonitorDO's own storage
 * (architecture Mechanism: one MonitorDO per monitor). The object holds a
 * single monitor under one key, and its Failures under keys that sort in
 * the order they were recorded. `heldMonitorId` tells the object's alarm
 * which monitor it holds; `failuresOf` reads the record back.
 */

import type { Failure } from '../../domain/monitor/monitor-state.js';
import type { Monitor, MonitorId } from '../../domain/monitor/monitor.js';
import type { MonitorStore } from '../../ports/monitor-store.js';

const MONITOR_KEY = 'monitor';
const FAILURE_COUNT_KEY = 'failure-count';
const FAILURE_PREFIX = 'failure:';
/** Wide enough that keys sort numerically for any count an object can reach. */
const SEQUENCE_WIDTH = 12;

// --- helpers ---

function failureKey(sequence: number): string {
  return `${FAILURE_PREFIX}${String(sequence).padStart(SEQUENCE_WIDTH, '0')}`;
}

// --- exports ---

export class DurableMonitorStore implements MonitorStore {
  readonly #storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
  }

  /** The id of the monitor this object holds, or null before one is put. */
  async heldMonitorId(): Promise<MonitorId | null> {
    return (await this.#storage.get<Monitor>(MONITOR_KEY))?.monitorId ?? null;
  }

  async get(monitorId: MonitorId): Promise<Monitor | null> {
    const held = await this.#storage.get<Monitor>(MONITOR_KEY);
    return held?.monitorId === monitorId ? held : null;
  }

  /** Keeps the monitor; another monitor in an object already holding one is a wiring fault and throws. */
  async put(monitor: Monitor): Promise<void> {
    const held = await this.heldMonitorId();
    if (held !== null && held !== monitor.monitorId) throw new Error(`this object holds monitor ${held}, not monitor ${monitor.monitorId}`);
    await this.#storage.put(MONITOR_KEY, monitor);
  }

  async recordFailures(monitorId: MonitorId, failures: readonly Failure[]): Promise<void> {
    if ((await this.heldMonitorId()) !== monitorId) return;
    const count = (await this.#storage.get<number>(FAILURE_COUNT_KEY)) ?? 0;
    const entries: Record<string, Failure | number> = { [FAILURE_COUNT_KEY]: count + failures.length };
    failures.forEach((failure, index) => {
      entries[failureKey(count + index)] = failure;
    });
    await this.#storage.put(entries);
  }

  /** The Failures recorded for the monitor, oldest first. */
  async failuresOf(monitorId: MonitorId): Promise<readonly Failure[]> {
    if ((await this.heldMonitorId()) !== monitorId) return [];
    return [...(await this.#storage.list<Failure>({ prefix: FAILURE_PREFIX })).values()];
  }
}
