/**
 * evaluateMetricRule -- MetricRuleDO's alarm: measure a Metric Alert Rule's
 * aggregate over its window and step its Incident (design Behaviors: Metric
 * incident opens and closes; State Machine: Metric Incident; architecture
 * Mechanism: MetricRuleDO reads counters, counts consecutive breaches, and
 * changes the Incident).
 *
 * The value is read from the Project's exact counters through ProjectClient;
 * when the Project cannot measure the aggregate, nothing changes. The
 * stepped state is kept whether or not the level changed, so runs of
 * consecutive breaches and recoveries carry over. Each Incident Change is
 * delivered through every action of the rule. Ports: ProjectClient,
 * ControlStore, IncidentStore, Channel, Clock.
 */

import { incidentMessageOf } from '../../domain/alerts/alert-message.js';
import type { Action } from '../../domain/alerts/issue-alert-rule.js';
import { closedIncident, stepIncident, type IncidentChange, type MetricAlertRule } from '../../domain/alerts/metric-incident.js';
import type { ProjectId } from '../../domain/ids.js';
import type { Channel } from '../../ports/channel.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { IncidentStore } from '../../ports/incident-store.js';
import type { ProjectClient } from '../../ports/project-client.js';
import { deliverAction, type DeliverySettings } from './deliver-action.js';

/** The Project a Metric Alert Rule watches and the actions that carry its Incident Changes. */
export type MetricRuleTarget = { readonly projectId: ProjectId; readonly actions: readonly Action[] };

export type EvaluateMetricRuleDeps = {
  projects: ProjectClient;
  control: ControlStore;
  incidents: IncidentStore;
  channels: readonly Channel[];
  clock: Clock;
  settings: DeliverySettings;
};

// --- flow ---

async function notify(change: IncidentChange, target: MetricRuleTarget, deps: EvaluateMetricRuleDeps): Promise<void> {
  const message = incidentMessageOf({ projectId: target.projectId, change });
  for (const action of target.actions) await deliverAction({ projectId: target.projectId, action, message }, deps);
}

// --- exports ---

export async function evaluateMetricRule(
  rule: MetricAlertRule,
  target: MetricRuleTarget,
  deps: EvaluateMetricRuleDeps,
): Promise<IncidentChange | null> {
  const at = deps.clock.now();
  const value = await deps.projects.metricValue(target.projectId, { aggregate: rule.aggregate, since: at - rule.windowMs });
  if (value === null) return null;
  const state = (await deps.incidents.get(rule.ruleId)) ?? closedIncident();
  const step = stepIncident({ rule, state, value, at });
  await deps.incidents.put(rule.ruleId, step.state);
  if (step.change !== null) await notify(step.change, target, deps);
  return step.change;
}
