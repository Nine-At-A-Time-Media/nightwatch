/**
 * LogDO -- the Durable Object holding one arrival log (the local stand-in for
 * K2). A thin shell: every method forwards to a module function over the
 * object's SQLite storage (src/adapters/logdo/log.ts), so the class adds no
 * step of its own that a bound Worker could reach over RPC.
 */

import { DurableObject } from 'cloudflare:workers';
import type { ArrivalRecord } from '../../domain/ingest/arrival.js';
import type { LeasedRecord, SubscriptionStart } from '../../domain/ingest/subscription.js';
import {
  ackRecords,
  appendRecord,
  ensureLogSchema,
  extendLeases,
  nackRecords,
  pullRecords,
  subscribe,
  type ExtendRequest,
  type HeldRequest,
  type PullRequest,
} from '../../adapters/logdo/log.js';

export class LogDO extends DurableObject<IngestEnv> {
  constructor(ctx: DurableObjectState, env: IngestEnv) {
    super(ctx, env);
    ensureLogSchema(ctx.storage.sql);
  }

  append(record: ArrivalRecord): { offset: number } {
    return appendRecord(this.ctx.storage.sql, record);
  }

  subscribe(request: { subscription: string; start: SubscriptionStart }): void {
    subscribe(this.ctx.storage.sql, request);
  }

  pull(request: PullRequest): LeasedRecord[] {
    return pullRecords(this.ctx.storage.sql, request);
  }

  ack(request: HeldRequest): void {
    ackRecords(this.ctx.storage.sql, request);
  }

  nack(request: HeldRequest): void {
    nackRecords(this.ctx.storage.sql, request);
  }

  extend(request: ExtendRequest): void {
    extendLeases(this.ctx.storage.sql, request);
  }
}
