/**
 * The Metric Alert Rule one MetricRuleDO evaluates: the rule, the Project it
 * watches with the actions that carry its Incident Changes, and its
 * resolution (milliseconds between evaluations), kept in the object's own
 * storage as the rule row was copied in. The evaluation alarm is the
 * object's one alarm.
 */

import type { Action } from '../../domain/alerts/issue-alert-rule.js';
import type { MetricAlertRule } from '../../domain/alerts/metric-incident.js';
import type { ProjectId } from '../../domain/ids.js';

export type HeldMetricRule = {
  readonly rule: MetricAlertRule;
  readonly target: { readonly projectId: ProjectId; readonly actions: readonly Action[] };
  readonly resolution: number;
};

const RULE_KEY = 'rule';

// --- actions ---

export async function heldMetricRule(storage: DurableObjectStorage): Promise<HeldMetricRule | null> {
  return (await storage.get<HeldMetricRule>(RULE_KEY)) ?? null;
}

/** Keeps the rule; another rule in an object already holding one is a wiring fault and throws. */
export async function holdMetricRule(storage: DurableObjectStorage, held: HeldMetricRule): Promise<void> {
  const existing = await heldMetricRule(storage);
  if (existing !== null && existing.rule.ruleId !== held.rule.ruleId) {
    throw new Error(`this object holds rule ${existing.rule.ruleId}, not rule ${held.rule.ruleId}`);
  }
  await storage.put(RULE_KEY, held);
}

export async function scheduleEvaluation(storage: DurableObjectStorage, at: number): Promise<void> {
  await storage.setAlarm(at);
}
