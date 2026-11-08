/**
 * MonitorStore -- one monitor's configuration and state, and the Failures
 * it recorded (design Releases and monitors, Cron Monitor, Uptime Monitor;
 * architecture Mechanism: one MonitorDO per monitor). The MonitorDO's own
 * storage in production, an in-memory fake in tests. Configuration is
 * copied in from the D1 monitor rows.
 */

import type { Failure } from '../domain/monitor/monitor-state.js';
import type { Monitor, MonitorId } from '../domain/monitor/monitor.js';

export interface MonitorStore {
  /** The monitor, or null when none is kept under the id. */
  get(monitorId: MonitorId): Promise<Monitor | null>;
  put(monitor: Monitor): Promise<void>;
  /** Appends Failures to the monitor's record of them, in order. */
  recordFailures(monitorId: MonitorId, failures: readonly Failure[]): Promise<void>;
}
