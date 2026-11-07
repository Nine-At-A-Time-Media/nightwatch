/**
 * sweepIssues -- the ProjectDO alarm's pass over its Issues (design
 * Behaviors: New becomes ongoing; Auto-resolve; architecture Mechanism,
 * Issues: alarms run sweeps and recompute Forecasts). In one IssueStore
 * transaction each Issue gets a fresh Forecast when one is due, then the
 * time-triggered transitions of the issue domain. The Issue Changes are
 * enqueued once the transaction has settled. Ports: IssueStore, EffectQueue,
 * Clock.
 */

import { computeForecast, forecastHours, isForecastDue } from '../../domain/issue/forecast.js';
import type { ProjectId } from '../../domain/ids.js';
import type { IssuePolicies } from '../../domain/issue/policies.js';
import type { IssueChange, IssueState } from '../../domain/issue/state.js';
import { sweep } from '../../domain/issue/sweep.js';
import type { Clock } from '../../ports/clock.js';
import type { EffectQueue } from '../../ports/effect-queue.js';
import type { IssueStore } from '../../ports/issue-store.js';

export type SweepIssuesDeps = { issues: IssueStore; effects: EffectQueue; clock: Clock; policies: IssuePolicies };

// --- flow ---

async function refreshForecast(state: IssueState, now: number, deps: SweepIssuesDeps): Promise<void> {
  const stored = await deps.issues.getForecast(state.issueId);
  if (!isForecastDue(stored?.computedAt ?? null, now, deps.policies.forecast)) return;
  const counts = await deps.issues.hourlyCounts({ issueId: state.issueId, ...forecastHours(now, deps.policies.forecast) });
  await deps.issues.putForecast(state.issueId, { ...computeForecast(counts, deps.policies.forecast), computedAt: now });
}

async function sweepOne(state: IssueState, now: number, deps: SweepIssuesDeps): Promise<readonly IssueChange[]> {
  await refreshForecast(state, now, deps);
  const swept = sweep(state, now, deps.policies);
  if (swept.changes.length === 0) return [];
  await deps.issues.putIssue(swept.state);
  await deps.issues.appendHistory(swept.changes);
  return swept.changes;
}

async function sweepAll(now: number, deps: SweepIssuesDeps): Promise<IssueChange[]> {
  const changes: IssueChange[] = [];
  for (const state of await deps.issues.listIssues()) changes.push(...(await sweepOne(state, now, deps)));
  return changes;
}

// --- exports ---

/** `project` names the Project whose store `deps.issues` is; ProjectDO holds one Project. */
export async function sweepIssues(project: ProjectId, deps: SweepIssuesDeps): Promise<IssueChange[]> {
  const now = deps.clock.now();
  const changes = await deps.issues.transact(() => sweepAll(now, deps));
  if (changes.length > 0) await deps.effects.enqueue(changes);
  return changes;
}
