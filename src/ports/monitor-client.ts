/**
 * MonitorClient -- the seam through which processing hands a Check-in to the
 * MonitorDO of its Project and monitor (architecture Mechanism, Releases,
 * health and monitors). The monitors Worker over a service binding in
 * production and locally; an in-memory fake in tests. A monitor the Project
 * does not hold is refused; a failure that retrying may fix throws.
 */

import type { MonitorChange } from '../domain/monitor/monitor-state.js';
import type { MonitorCheckIn } from '../domain/processing/check-in.js';
import type { Refusal } from '../domain/refusal.js';

export interface MonitorClient {
  /** Advances the monitor with the Check-in; answers the monitor issue change it made, or null. */
  checkIn(checkIn: MonitorCheckIn): Promise<MonitorChange | null | Refusal>;
}
