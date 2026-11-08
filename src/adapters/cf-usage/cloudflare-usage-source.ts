/**
 * CloudflareUsageSource -- UsageSource over the Cloudflare GraphQL Analytics
 * API (architecture Seams: Platform usage). One query per comparison asks
 * for the account's Workers and Durable Objects requests since the start of
 * the current UTC month, and sums them per product. A refused request or an
 * answer carrying errors throws, so the scheduler never compares nothing
 * against the limits as if it were no use. `fetch` and the clock are
 * injected; the account id and API token are the scheduler's settings.
 *
 * NoUsageSource is the local stage's stand-in (architecture Local
 * development): it measures nothing, needing no account.
 */

import type { ProductUsage } from '../../domain/operating/platform-usage.js';
import type { Clock } from '../../ports/clock.js';
import type { UsageSource } from '../../ports/usage-source.js';

export type UsageFetch = (url: string, init: RequestInit) => Promise<Response>;

export type CloudflareUsageSourceOptions = {
  readonly fetch: UsageFetch;
  readonly clock: Clock;
  readonly accountId: string;
  readonly apiToken: string;
};

type Groups = readonly { readonly sum?: { readonly requests?: number } }[];

type Answer = {
  readonly data?: {
    readonly viewer?: {
      readonly accounts?: readonly {
        readonly workersInvocationsAdaptive?: Groups;
        readonly durableObjectsInvocationsAdaptiveGroups?: Groups;
      }[];
    };
  } | null;
  readonly errors?: readonly { readonly message?: string }[] | null;
};

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const GROUP_LIMIT = 10_000;
const QUERY = `query PlatformUsage($accountTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: ${GROUP_LIMIT}, filter: { datetime_geq: $since, datetime_leq: $until }) { sum { requests } }
      durableObjectsInvocationsAdaptiveGroups(limit: ${GROUP_LIMIT}, filter: { datetime_geq: $since, datetime_leq: $until }) { sum { requests } }
    }
  }
}`;

// --- helpers ---

function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function total(groups: Groups | undefined): number {
  return (groups ?? []).reduce((sum, group) => sum + (group.sum?.requests ?? 0), 0);
}

function usageOf(answer: Answer): ProductUsage[] {
  const message = answer.errors?.map((error) => error.message ?? 'unknown error').join('; ');
  if (message) throw new Error(`usage query failed: ${message}`);
  const account = answer.data?.viewer?.accounts?.[0];
  return [
    { product: 'workers_requests', used: total(account?.workersInvocationsAdaptive) },
    { product: 'durable_objects_requests', used: total(account?.durableObjectsInvocationsAdaptiveGroups) },
  ];
}

// --- exports ---

export class CloudflareUsageSource implements UsageSource {
  readonly #options: CloudflareUsageSourceOptions;

  constructor(options: CloudflareUsageSourceOptions) {
    this.#options = options;
  }

  async usage(): Promise<readonly ProductUsage[]> {
    const { fetch, clock, accountId, apiToken } = this.#options;
    const now = clock.now();
    const variables = { accountTag: accountId, since: new Date(monthStart(now)).toISOString(), until: new Date(now).toISOString() };
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (!response.ok) throw new Error(`usage query refused with status ${response.status}`);
    return usageOf(await response.json<Answer>());
  }
}

export class NoUsageSource implements UsageSource {
  async usage(): Promise<readonly ProductUsage[]> {
    return [];
  }
}
