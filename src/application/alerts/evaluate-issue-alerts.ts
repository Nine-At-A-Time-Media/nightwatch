/**
 * evaluateIssueAlerts -- the notifier's pass over one Alert Signal: an Issue
 * Change from the `effects` queue, an Event that arrived, or both (design
 * Behaviors: New issue alert; Quiet period; Frequency alert; Filter blocks;
 * Undelivered alert is visible; architecture Mechanism, Alerts and
 * notifications).
 *
 * Each of the Project's Issue Alert Rules is evaluated against the Issue as
 * it is now. Frequency triggers read the exact counters of the Issue over
 * the rule's window, so a rule fires on the Event that satisfied it, well
 * within the Alert Evaluation Delay. The quiet period reads the rule's last
 * firing for the Issue. A firing is recorded before its actions run, which
 * starts the quiet period, and again with each action's delivery once
 * Nightwatch stops trying, which is what Members see on the rule. When
 * Digests are on, email actions are gathered into the recipient's Digest
 * and stay pending; deliverDigest sends them.
 *
 * Ports: ControlStore, ProjectClient, Channel, DigestQueue, Clock. The
 * Project is named beside the signal, which does not carry it.
 */

import { alertFiring, recordDelivery, type AlertFiring, type DeliveryStatus } from '../../domain/alerts/alert-firing.js';
import { alertMessageOf, frequencyWindows, issueKindOf } from '../../domain/alerts/alert-message.js';
import type { DigestItem } from '../../domain/alerts/digest.js';
import {
  evaluateRule,
  type Action,
  type AlertContext,
  type AlertCounts,
  type AlertEvent,
  type EmailRecipient,
  type IssueAlertRule,
} from '../../domain/alerts/issue-alert-rule.js';
import type { IssueId, ProjectId } from '../../domain/ids.js';
import type { IssueChange } from '../../domain/issue/state.js';
import { latestReleaseOf } from '../../domain/release/ordering.js';
import type { Channel } from '../../ports/channel.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { DigestQueue } from '../../ports/digest-queue.js';
import type { ProjectClient } from '../../ports/project-client.js';
import { deliverAction, emailAddresses, type DeliverySettings } from './deliver-action.js';

/** What the notifier evaluates: the Issue, the Issue Change if there was one, and the Event if one arrived. */
export type AlertSignal = { readonly issueId: IssueId; readonly change: IssueChange | null; readonly event: AlertEvent | null };

export type EvaluateIssueAlertsDeps = {
  control: ControlStore;
  projects: ProjectClient;
  channels: readonly Channel[];
  /** Where issue alert emails are gathered; null sends each email at once. */
  digests: DigestQueue | null;
  clock: Clock;
  settings: DeliverySettings;
};

type IssueFacts = Pick<AlertContext, 'issue' | 'issueKind' | 'assignee' | 'latestRelease'>;

type Scope = { projectId: ProjectId; signal: AlertSignal; now: number };

// --- helpers ---

function titleOf(signal: AlertSignal): string {
  return signal.event?.title ?? `issue ${signal.issueId}`;
}

// --- flow: what the evaluation reads ---

async function issueFactsOf(projectId: ProjectId, issueId: IssueId, projects: ProjectClient): Promise<IssueFacts | null> {
  const issue = await projects.getIssue(projectId, issueId);
  if (issue === null) return null;
  const fingerprints = await projects.fingerprintsOf(projectId, issueId);
  const assignee = await projects.assigneeOf(projectId, issueId);
  const latestRelease = latestReleaseOf(await projects.releasesSeen(projectId));
  return { issue, issueKind: issueKindOf(fingerprints.length), assignee, latestRelease };
}

async function countsOf(rule: IssueAlertRule, scope: Scope, projects: ProjectClient): Promise<AlertCounts> {
  const windows = frequencyWindows(rule);
  const { projectId, signal, now } = scope;
  const eventsInWindow =
    windows.events === null ? 0 : await projects.countEvents(projectId, { issueId: signal.issueId, since: now - windows.events });
  const usersInWindow =
    windows.users === null ? 0 : await projects.countUsers(projectId, { issueId: signal.issueId, since: now - windows.users });
  return { eventsInWindow, usersInWindow };
}

async function contextOf(rule: IssueAlertRule, scope: Scope, facts: IssueFacts, projects: ProjectClient): Promise<AlertContext> {
  const counts = await countsOf(rule, scope, projects);
  const last = await projects.lastFiring(scope.projectId, { ruleId: rule.ruleId, issueId: scope.signal.issueId });
  return { ...facts, change: scope.signal.change, event: scope.signal.event, counts, lastFiredAt: last?.at ?? null, now: scope.now };
}

// --- flow: delivering a firing ---

async function gatherIntoDigests(
  gathering: { to: EmailRecipient; firing: AlertFiring; scope: Scope },
  deps: { control: ControlStore; digests: DigestQueue },
): Promise<DeliveryStatus> {
  const { firing, scope } = gathering;
  const item: DigestItem = { issueId: firing.issueId, title: titleOf(scope.signal), at: firing.at };
  for (const recipient of await emailAddresses({ projectId: scope.projectId, to: gathering.to }, deps.control)) {
    await deps.digests.add({ ruleId: firing.ruleId, recipient }, item);
  }
  return 'pending';
}

async function deliverOne(action: Action, firing: AlertFiring, scope: Scope, deps: EvaluateIssueAlertsDeps): Promise<DeliveryStatus> {
  if (action.kind === 'email' && deps.digests !== null) {
    return gatherIntoDigests({ to: action.to, firing, scope }, { control: deps.control, digests: deps.digests });
  }
  const message = alertMessageOf({ projectId: scope.projectId, firing, title: titleOf(scope.signal) });
  return deliverAction({ projectId: scope.projectId, action, message }, deps);
}

async function deliverFiring(firing: AlertFiring, scope: Scope, deps: EvaluateIssueAlertsDeps): Promise<AlertFiring> {
  let delivered = firing;
  for (const [index, delivery] of firing.deliveries.entries()) {
    delivered = recordDelivery(delivered, index, await deliverOne(delivery.action, firing, scope, deps));
  }
  return delivered;
}

// --- flow: one rule ---

async function evaluateOne(
  rule: IssueAlertRule,
  scope: Scope,
  facts: IssueFacts,
  deps: EvaluateIssueAlertsDeps,
): Promise<AlertFiring | null> {
  const evaluation = evaluateRule(rule, await contextOf(rule, scope, facts, deps.projects));
  if (!evaluation.fire) return null;
  const firing = alertFiring({ rule, issueId: scope.signal.issueId, at: scope.now });
  await deps.projects.recordFiring(scope.projectId, firing);
  const delivered = await deliverFiring(firing, scope, deps);
  await deps.projects.recordFiring(scope.projectId, delivered);
  return delivered;
}

// --- exports ---

export async function evaluateIssueAlerts(project: ProjectId, signal: AlertSignal, deps: EvaluateIssueAlertsDeps): Promise<AlertFiring[]> {
  const rules = await deps.control.issueAlertRules(project);
  if (rules.length === 0) return [];
  const facts = await issueFactsOf(project, signal.issueId, deps.projects);
  if (facts === null) return [];
  const scope: Scope = { projectId: project, signal, now: deps.clock.now() };
  const fired: AlertFiring[] = [];
  for (const rule of rules) {
    const firing = await evaluateOne(rule, scope, facts, deps);
    if (firing !== null) fired.push(firing);
  }
  return fired;
}
