/**
 * DurableQuotaGate -- the QuotaGate over QuotaDO, one object per Project, so
 * one Project's exhausted Quota never touches another's. The Project's Quotas
 * (window and per-category limits) come from its config entry; a Project or
 * category without a limit is unbounded and costs no object call.
 *
 * Not yet here (architecture, Mechanism: Ingest): QuotaDO leasing units to
 * each isolate, Client Key enabled state, and the Rate Limiting binding in
 * front. Every check is one object call.
 */

import type { QuotaDecision, QuotaRequest } from '../../domain/ingest/arrival.js';
import type { Clock } from '../../ports/clock.js';
import type { QuotaGate } from '../../ports/quota-gate.js';
import type { ProjectQuotas } from '../kv/kv-project-config-source.js';
import type { ConsumeRequest, ConsumeResult } from './quota.js';

const REASON = 'quota-exceeded';

/** Where a Project's Quotas are read from. */
export interface QuotaLimits {
  quotas(projectId: string): Promise<ProjectQuotas | null>;
}

/** The RPC surface QuotaDO offers; a Durable Object stub of QuotaDO satisfies it. */
export interface QuotaCounter {
  consume(request: ConsumeRequest): Promise<ConsumeResult>;
}

export class DurableQuotaGate implements QuotaGate {
  readonly #limits: QuotaLimits;
  readonly #counterFor: (projectId: string) => QuotaCounter;
  readonly #clock: Clock;

  constructor({ limits, counterFor, clock }: { limits: QuotaLimits; counterFor: (projectId: string) => QuotaCounter; clock: Clock }) {
    this.#limits = limits;
    this.#counterFor = counterFor;
    this.#clock = clock;
  }

  async check({ projectId, category, quantity }: QuotaRequest): Promise<QuotaDecision> {
    const quotas = await this.#limits.quotas(projectId);
    const limit = quotas?.limits[category];
    if (!quotas || limit === undefined) return { allowed: true };
    const counter = this.#counterFor(projectId);
    const result = await counter.consume({ category, quantity, limit, windowMs: quotas.windowSeconds * 1000, now: this.#clock.now() });
    if (result.allowed) return { allowed: true };
    return {
      allowed: false,
      advice: { retryAfterSeconds: result.retryAfterSeconds, categories: [category], scope: 'project', reason: REASON },
    };
  }
}
