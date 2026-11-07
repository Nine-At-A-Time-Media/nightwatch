/**
 * The monitors Worker wiring: the one place that names the concrete adapter
 * behind each port advanceMonitor and evaluateMetricRule take, and reads the
 * Worker's settings from its vars. Only the local stage has its adapters;
 * any other stage is refused rather than silently given a stand-in.
 */

import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { DurableIncidentStore } from '../../adapters/do/durable-incident-store.js';
import { DurableMonitorStore } from '../../adapters/do/durable-monitor-store.js';
import { DurableProjectClient, type ProjectNamespace } from '../../adapters/do/durable-project-client.js';
import { FetchUptimeProbe } from '../../adapters/fetch/uptime-probe.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { WebhookChannel } from '../../adapters/webhook/webhook-channel.js';
import type { DeliverySettings } from '../../application/alerts/deliver-action.js';
import type { Channel } from '../../ports/channel.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { IncidentStore } from '../../ports/incident-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { UptimeProbe } from '../../ports/uptime-probe.js';

/** The Worker's bindings; ProjectDO lives in the core Worker, so wrangler cannot type its namespace here. */
export type MonitorsBindings = Omit<MonitorsEnv, 'PROJECT'> & { readonly PROJECT: ProjectNamespace };

/** What one MonitorDO hands its steps: its adapters and its storage for the alarm. */
export type MonitorRuntime = {
  readonly monitors: DurableMonitorStore;
  readonly projects: ProjectClient;
  readonly probe: UptimeProbe;
  readonly clock: Clock;
  readonly storage: DurableObjectStorage;
};

/** What one MetricRuleDO hands its steps. */
export type MetricRuleRuntime = {
  readonly projects: ProjectClient;
  readonly control: ControlStore;
  readonly incidents: IncidentStore;
  readonly channels: readonly Channel[];
  readonly clock: Clock;
  readonly settings: DeliverySettings;
  readonly storage: DurableObjectStorage;
};

const LOCAL_STAGE = 'local';

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`monitors setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

function requireLocalStage(env: MonitorsBindings): void {
  if (env.STAGE !== LOCAL_STAGE) throw new Error(`stage ${env.STAGE} has no monitors adapters`);
}

// --- wiring ---

export function monitorRuntime({ storage, env }: { storage: DurableObjectStorage; env: MonitorsBindings }): MonitorRuntime {
  requireLocalStage(env);
  const clock = new SystemClock();
  return {
    monitors: new DurableMonitorStore(storage),
    projects: new DurableProjectClient({ namespace: env.PROJECT }),
    probe: new FetchUptimeProbe({
      fetch: (url, init) => fetch(url, init),
      clock,
      timeout: positive({ name: 'UPTIME_TIMEOUT_MS', value: env.UPTIME_TIMEOUT_MS }),
    }),
    clock,
    storage,
  };
}

export function metricRuleRuntime({ storage, env }: { storage: DurableObjectStorage; env: MonitorsBindings }): MetricRuleRuntime {
  requireLocalStage(env);
  return {
    projects: new DurableProjectClient({ namespace: env.PROJECT }),
    control: new D1ControlStore(env.CONTROL),
    incidents: new DurableIncidentStore(storage),
    channels: [new WebhookChannel((input, init) => fetch(input, init))],
    clock: new SystemClock(),
    settings: { deliveryAttempts: positive({ name: 'DELIVERY_ATTEMPTS', value: env.DELIVERY_ATTEMPTS }) },
    storage,
  };
}
