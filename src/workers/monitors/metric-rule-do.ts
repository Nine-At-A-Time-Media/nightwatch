/**
 * MetricRuleDO -- the Durable Object holding one Metric Alert Rule's
 * Incident (architecture Mechanism: Alerts and notifications), named by the
 * rule id. Its constructor builds the runtime once (deps.ts); its RPC
 * methods forward to one module function each (metric-rule-steps.ts), and
 * its alarm evaluates the rule at the rule's resolution.
 */

import { DurableObject } from 'cloudflare:workers';
import type { HeldMetricRule } from '../../adapters/do/metric-rule-config.js';
import type { IncidentState } from '../../domain/alerts/metric-incident.js';
import type { Refusal } from '../../domain/refusal.js';
import { metricRuleRuntime, type MetricRuleRuntime, type MonitorsBindings } from './deps.js';
import * as steps from './metric-rule-steps.js';

export class MetricRuleDO extends DurableObject<MonitorsBindings> {
  readonly #runtime: MetricRuleRuntime;

  constructor(ctx: DurableObjectState, env: MonitorsBindings) {
    super(ctx, env);
    this.#runtime = metricRuleRuntime({ storage: ctx.storage, env });
  }

  override async alarm(): Promise<void> {
    await steps.evaluateStep(this.#runtime);
  }

  configure(held: HeldMetricRule): Promise<null | Refusal> {
    return steps.configureStep(this.#runtime, held);
  }

  incident(): Promise<IncidentState | null> {
    return steps.incidentStep(this.#runtime);
  }
}
