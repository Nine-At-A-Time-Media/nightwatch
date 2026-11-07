/**
 * The scheduler Worker wiring: the one place that names the concrete adapter
 * behind each port its tick uses, and reads its settings (RetentionPolicy,
 * Platform Soft Limits, operator Destinations) from the Worker's vars. The
 * stage picks the UsageSource: the local stage measures nothing; any other
 * stage reads the Cloudflare analytics API and refuses to start without an
 * account id and API token.
 */

import { CloudflareUsageSource, NoUsageSource } from '../../adapters/cf-usage/cloudflare-usage-source.js';
import { D1ControlStore } from '../../adapters/d1/d1-control-store.js';
import { DurableProjectClient, type ProjectNamespace } from '../../adapters/do/durable-project-client.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import { WebhookChannel } from '../../adapters/webhook/webhook-channel.js';
import type { PlatformSoftLimits } from '../../domain/operating/platform-usage.js';
import type { RetentionPolicy } from '../../domain/retention/retention.js';
import type { Channel, Destination } from '../../ports/channel.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import type { UsageSource } from '../../ports/usage-source.js';

/** The Worker's bindings; ProjectDO lives in the core Worker, and the usage API's account and token exist off the local stage only. */
export type SchedulerBindings = Omit<SchedulerEnv, 'PROJECT'> & {
  readonly PROJECT: ProjectNamespace;
  readonly CLOUDFLARE_ACCOUNT_ID?: string;
  readonly CLOUDFLARE_API_TOKEN?: string;
};

/** What one scheduled run uses. */
export type SchedulerRuntime = {
  readonly control: ControlStore;
  readonly projects: ProjectClient;
  readonly usage: UsageSource;
  readonly channels: readonly Channel[];
  readonly clock: Clock;
  readonly retention: RetentionPolicy;
  readonly limits: PlatformSoftLimits;
  readonly operator: readonly Destination[];
};

const LOCAL_STAGE = 'local';

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`scheduler setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

function retentionPolicy(env: SchedulerBindings): RetentionPolicy {
  return {
    raw: positive({ name: 'RAW_RETENTION_MS', value: env.RAW_RETENTION_MS }),
    event: positive({ name: 'EVENT_RETENTION_MS', value: env.EVENT_RETENTION_MS }),
    attachment: positive({ name: 'ATTACHMENT_RETENTION_MS', value: env.ATTACHMENT_RETENTION_MS }),
    report: positive({ name: 'REPORT_RETENTION_MS', value: env.REPORT_RETENTION_MS }),
    outcome: positive({ name: 'OUTCOME_RETENTION_MS', value: env.OUTCOME_RETENTION_MS }),
    history: positive({ name: 'HISTORY_RETENTION_MS', value: env.HISTORY_RETENTION_MS }),
  };
}

function softLimits(value: unknown): PlatformSoftLimits {
  if (typeof value !== 'object' || value === null) throw new Error('scheduler setting PLATFORM_SOFT_LIMITS must be an object');
  return new Map(
    Object.entries(value).map(([product, limit]) => [product, positive({ name: `PLATFORM_SOFT_LIMITS.${product}`, value: limit })]),
  );
}

function operatorDestinations(value: unknown): Destination[] {
  if (!Array.isArray(value) || !value.every((url) => typeof url === 'string')) {
    throw new Error('scheduler setting OPERATOR_WEBHOOK_URLS must be a list of URLs');
  }
  return value.map((url: string) => ({ kind: 'webhook', url }));
}

function required({ name, value }: { name: string; value: string | undefined }): string {
  if (!value) throw new Error(`scheduler setting ${name} is required off the local stage`);
  return value;
}

function usageSource(env: SchedulerBindings, clock: Clock): UsageSource {
  if (env.STAGE === LOCAL_STAGE) return new NoUsageSource();
  return new CloudflareUsageSource({
    fetch: (url, init) => fetch(url, init),
    clock,
    accountId: required({ name: 'CLOUDFLARE_ACCOUNT_ID', value: env.CLOUDFLARE_ACCOUNT_ID }),
    apiToken: required({ name: 'CLOUDFLARE_API_TOKEN', value: env.CLOUDFLARE_API_TOKEN }),
  });
}

// --- wiring ---

export function schedulerRuntime(env: SchedulerBindings): SchedulerRuntime {
  const clock = new SystemClock();
  return {
    control: new D1ControlStore(env.CONTROL),
    projects: new DurableProjectClient({ namespace: env.PROJECT }),
    usage: usageSource(env, clock),
    channels: [new WebhookChannel((input, init) => fetch(input, init))],
    clock,
    retention: retentionPolicy(env),
    limits: softLimits(env.PLATFORM_SOFT_LIMITS),
    operator: operatorDestinations(env.OPERATOR_WEBHOOK_URLS),
  };
}
