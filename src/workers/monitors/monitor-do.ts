/**
 * MonitorDO -- the Durable Object holding one Cron or Uptime Monitor
 * (architecture Mechanism: Releases, health and monitors), named by its
 * Project and monitor (monitorObjectName). Its constructor is the
 * composition root that builds the runtime once (deps.ts); its RPC methods
 * take plain values and forward to one module function each
 * (monitor-steps.ts), and its alarm advances the monitor with no input.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Failure, MonitorChange } from '../../domain/monitor/monitor-state.js';
import type { Monitor, MonitorId } from '../../domain/monitor/monitor.js';
import type { Refusal } from '../../domain/refusal.js';
import { monitorRuntime, type MonitorRuntime, type MonitorsBindings } from './deps.js';
import * as steps from './monitor-steps.js';

export class MonitorDO extends DurableObject<MonitorsBindings> {
  readonly #runtime: MonitorRuntime;

  constructor(ctx: DurableObjectState, env: MonitorsBindings) {
    super(ctx, env);
    this.#runtime = monitorRuntime({ storage: ctx.storage, env });
  }

  override async alarm(): Promise<void> {
    await steps.alarmStep(this.#runtime);
  }

  configure(monitor: Monitor): Promise<void> {
    return steps.configureStep(this.#runtime, monitor);
  }

  checkIn(request: steps.CheckInRequest): Promise<MonitorChange | null | Refusal> {
    return steps.checkInStep(this.#runtime, request);
  }

  // --- reads ---

  monitor(monitorId: MonitorId): Promise<Monitor | null> {
    return steps.monitorStep(this.#runtime, monitorId);
  }

  failures(monitorId: MonitorId): Promise<readonly Failure[]> {
    return steps.failuresStep(this.#runtime, monitorId);
  }
}
