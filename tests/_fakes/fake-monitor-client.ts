// FakeMonitorClient -- a MonitorClient that keeps every check-in it was given
// and holds the monitors a test registers; a check-in for any other monitor
// is refused as MonitorDO refuses it.
import type { MonitorChange } from '../../src/domain/monitor/monitor-state.js';
import type { MonitorCheckIn } from '../../src/domain/processing/check-in.js';
import { refusal, type Refusal } from '../../src/domain/refusal.js';
import type { MonitorClient } from '../../src/ports/monitor-client.js';

export class FakeMonitorClient implements MonitorClient {
  readonly checkIns: MonitorCheckIn[] = [];
  readonly #held = new Set<string>();

  hold(projectId: string, monitorId: string): void {
    this.#held.add(`${projectId}/${monitorId}`);
  }

  async checkIn(checkIn: MonitorCheckIn): Promise<MonitorChange | null | Refusal> {
    this.checkIns.push(checkIn);
    return this.#held.has(`${checkIn.projectId}/${checkIn.monitorId}`) ? null : refusal('unknown-monitor');
  }
}
