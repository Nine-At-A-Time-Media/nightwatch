/**
 * StreamPumpDO -- one pump on the arrival log's `processing` subscription
 * (architecture, Mechanism: Stream consumption and processing). A thin
 * shell: its constructor is the pump's composition root, and its kick and
 * alarm forward to module functions (pump-steps.ts).
 */

import { DurableObject } from 'cloudflare:workers';
import { pumpPlan, pumpPorts } from './deps.js';
import { kickStep, pumpStep, type PumpRuntime } from './pump-steps.js';

export class StreamPumpDO extends DurableObject<ProcessorEnv> {
  readonly #runtime: PumpRuntime;

  constructor(ctx: DurableObjectState, env: ProcessorEnv) {
    super(ctx, env);
    this.#runtime = { storage: ctx.storage, ports: pumpPorts(env), plan: pumpPlan(env) };
  }

  /** Starts the pump under `name`, unless it is already running. */
  async kick(name: string): Promise<void> {
    await kickStep({ storage: this.ctx.storage, now: this.#runtime.ports.clock.now(), name });
  }

  override async alarm(): Promise<void> {
    await pumpStep(this.#runtime);
  }
}
