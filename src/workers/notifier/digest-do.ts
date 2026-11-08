/**
 * DigestDO -- the Durable Object holding one Digest, one per recipient and
 * Issue Alert Rule (architecture Mechanism, Alerts and notifications). Its
 * constructor builds the runtime once; its RPC methods are exactly the
 * DigestQueue operations, each forwarding to a module function over the
 * object's storage (src/adapters/do/digest.ts), and its alarm runs
 * deliverDigest (steps.ts). The class adds no step of its own that a bound
 * Worker could reach over RPC.
 */

import { DurableObject } from 'cloudflare:workers';
import { gatherDigestItem, takeDigest } from '../../adapters/do/digest.js';
import type { Digest, DigestItem } from '../../domain/alerts/digest.js';
import type { DigestKey, DigestQueue } from '../../ports/digest-queue.js';
import { digestRuntime, type DigestRuntime, type NotifierBindings } from './deps.js';
import { deliverHeldDigest } from './steps.js';

export class DigestDO extends DurableObject<NotifierBindings> implements DigestQueue {
  readonly #runtime: DigestRuntime;

  constructor(ctx: DurableObjectState, env: NotifierBindings) {
    super(ctx, env);
    this.#runtime = digestRuntime(env);
  }

  add(key: DigestKey, item: DigestItem): Promise<number> {
    return gatherDigestItem(this.ctx.storage, { key, item, policy: this.#runtime.policy });
  }

  take(key: DigestKey): Promise<Digest> {
    return takeDigest(this.ctx.storage, key);
  }

  override async alarm(): Promise<void> {
    await deliverHeldDigest(this.ctx.storage, this.#runtime);
  }
}
