/**
 * The ProjectDO wiring: the one place that names the concrete adapter behind
 * each port its use cases take, and reads the ProjectDO settings (dedup
 * window, sweep interval, IssuePolicies) from the core Worker's vars. Only
 * the local stage has its adapters; any other stage is refused rather than
 * silently given a stand-in.
 */

import { claimedProject } from '../../adapters/do-sqlite/project-identity.js';
import { SqliteIssueStore } from '../../adapters/do-sqlite/sqlite-issue-store.js';
import { QueueEffectQueue } from '../../adapters/queues/queue-effect-queue.js';
import { RandomIds } from '../../adapters/runtime/random-ids.js';
import { SystemClock } from '../../adapters/runtime/system-clock.js';
import type { IssuePolicies } from '../../domain/issue/policies.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { Ids } from '../../ports/ids.js';
import type { IssueStore } from '../../ports/issue-store.js';

/** What one ProjectDO hands its steps: its adapters, its policies, and its storage for the sweep alarm. */
export type ProjectRuntime = {
  readonly issues: IssueStore;
  readonly effects: EffectQueue;
  readonly clock: Clock;
  readonly ids: Ids;
  readonly policies: IssuePolicies;
  readonly storage: DurableObjectStorage;
  readonly sweepInterval: number;
};

const LOCAL_STAGE = 'local';

// --- settings ---

function positive({ name, value }: { name: string; value: unknown }): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`core setting ${name} must be a positive number, got ${String(value)}`);
  return number;
}

/** 0 or less means never. */
function optionalAge({ name, value }: { name: string; value: unknown }): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`core setting ${name} must be a number, got ${String(value)}`);
  return number > 0 ? number : null;
}

export function issuePolicies(env: CoreEnv): IssuePolicies {
  return {
    newIssueAge: positive({ name: 'NEW_ISSUE_AGE_MS', value: env.NEW_ISSUE_AGE_MS }),
    settleAge: positive({ name: 'SETTLE_AGE_MS', value: env.SETTLE_AGE_MS }),
    inboxExpiry: positive({ name: 'INBOX_EXPIRY_MS', value: env.INBOX_EXPIRY_MS }),
    autoResolveAge: optionalAge({ name: 'AUTO_RESOLVE_AGE_MS', value: env.AUTO_RESOLVE_AGE_MS }),
    earlyEscalation: {
      youngAge: positive({ name: 'EARLY_ESCALATION_YOUNG_AGE_MS', value: env.EARLY_ESCALATION_YOUNG_AGE_MS }),
      minimumCount: positive({ name: 'EARLY_ESCALATION_MINIMUM_COUNT', value: env.EARLY_ESCALATION_MINIMUM_COUNT }),
      rateMultiple: positive({ name: 'EARLY_ESCALATION_RATE_MULTIPLE', value: env.EARLY_ESCALATION_RATE_MULTIPLE }),
    },
    forecast: {
      window: positive({ name: 'FORECAST_WINDOW_MS', value: env.FORECAST_WINDOW_MS }),
      spreadMultiple: positive({ name: 'FORECAST_SPREAD_MULTIPLE', value: env.FORECAST_SPREAD_MULTIPLE }),
      floor: positive({ name: 'FORECAST_FLOOR', value: env.FORECAST_FLOOR }),
      refreshInterval: positive({ name: 'FORECAST_REFRESH_INTERVAL_MS', value: env.FORECAST_REFRESH_INTERVAL_MS }),
    },
  };
}

// --- wiring ---

export function projectRuntime({ storage, env }: { storage: DurableObjectStorage; env: CoreEnv }): ProjectRuntime {
  if (env.STAGE !== LOCAL_STAGE) throw new Error(`stage ${env.STAGE} has no ProjectDO adapters`);
  return {
    issues: new SqliteIssueStore({ storage, dedupWindow: positive({ name: 'DEDUP_WINDOW_MS', value: env.DEDUP_WINDOW_MS }) }),
    effects: new QueueEffectQueue(env.EFFECTS, () => claimedProject(storage.sql)),
    clock: new SystemClock(),
    ids: new RandomIds(),
    policies: issuePolicies(env),
    storage,
    sweepInterval: positive({ name: 'SWEEP_INTERVAL_MS', value: env.SWEEP_INTERVAL_MS }),
  };
}
