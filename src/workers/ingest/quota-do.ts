/**
 * QuotaDO -- the Durable Object holding one Project's Quota counters. A thin
 * shell: its one method forwards to a module function over the object's
 * SQLite storage (src/adapters/do/quota.ts).
 */

import { DurableObject } from 'cloudflare:workers';
import { consumeQuota, ensureQuotaSchema, type ConsumeRequest, type ConsumeResult } from '../../adapters/do/quota.js';

export class QuotaDO extends DurableObject<IngestEnv> {
  constructor(ctx: DurableObjectState, env: IngestEnv) {
    super(ctx, env);
    ensureQuotaSchema(ctx.storage.sql);
  }

  consume(request: ConsumeRequest): ConsumeResult {
    return consumeQuota(this.ctx.storage.sql, request);
  }
}
