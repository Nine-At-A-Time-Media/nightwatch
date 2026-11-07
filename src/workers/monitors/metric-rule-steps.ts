/**
 * The MetricRuleDO steps -- one module function per MetricRuleDO operation,
 * plus the alarm (cloudflare-hosting: every step past authorization is a
 * module function, never a method). The alarm runs evaluateMetricRule once
 * per the rule's resolution and sets the next evaluation one resolution
 * later.
 */

import { evaluateMetricRule } from '../../application/alerts/evaluate-metric-rule.js';
import { heldMetricRule, holdMetricRule, scheduleEvaluation, type HeldMetricRule } from '../../adapters/do/metric-rule-config.js';
import { metricAlertRule, type IncidentChange, type IncidentState } from '../../domain/alerts/metric-incident.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { MetricRuleRuntime } from './deps.js';

// --- predicates ---

function isResolution(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// --- flow ---

/** The alarm: evaluates the held rule, then sets the next evaluation. */
export async function evaluateStep(r: MetricRuleRuntime): Promise<IncidentChange | null> {
  const held = await heldMetricRule(r.storage);
  if (held === null) return null;
  const change = await evaluateMetricRule(held.rule, held.target, r);
  await scheduleEvaluation(r.storage, r.clock.now() + held.resolution);
  return change;
}

/** Keeps the rule as configured (copied in from its rule row) and sets its first evaluation; an invalid rule is refused. */
export async function configureStep(r: MetricRuleRuntime, held: HeldMetricRule): Promise<null | Refusal> {
  const rule = metricAlertRule(held.rule);
  if (isRefusal(rule)) return rule;
  if (!isResolution(held.resolution)) return refusal('metric_alert_rule_invalid');
  await holdMetricRule(r.storage, { ...held, rule });
  await scheduleEvaluation(r.storage, r.clock.now() + held.resolution);
  return null;
}

export async function incidentStep(r: MetricRuleRuntime): Promise<IncidentState | null> {
  const held = await heldMetricRule(r.storage);
  return held === null ? null : r.incidents.get(held.rule.ruleId);
}
