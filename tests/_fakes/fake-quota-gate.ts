// FakeQuotaGate -- QuotaGate with per-Project, per-category limits counted in memory.
// A Project or category without a limit is unbounded.
import type { QuotaDecision, QuotaRequest } from '../../src/domain/ingest/arrival.js';
import type { DataCategory } from '../../src/domain/protocol/retry-advice.js';
import type { QuotaGate } from '../../src/ports/quota-gate.js';

type Limits = Record<string, Partial<Record<DataCategory, number>>>;

export class FakeQuotaGate implements QuotaGate {
  readonly used = new Map<string, number>();
  readonly requests: QuotaRequest[] = [];

  constructor(
    private readonly limits: Limits = {},
    private readonly retryAfterSeconds = 60,
  ) {}

  async check(request: QuotaRequest): Promise<QuotaDecision> {
    this.requests.push(request);
    const limit = this.limits[request.projectId]?.[request.category];
    const key = `${request.projectId}/${request.category}`;
    const used = this.used.get(key) ?? 0;
    if (limit !== undefined && used + request.quantity > limit) {
      return {
        allowed: false,
        advice: { retryAfterSeconds: this.retryAfterSeconds, categories: [request.category], scope: 'project', reason: 'quota-exceeded' },
      };
    }
    this.used.set(key, used + request.quantity);
    return { allowed: true };
  }
}
