/**
 * Alert messages -- what Nightwatch says when an Issue Alert Rule fires,
 * when an Incident changes, when a Digest is due, and in a Workflow
 * Notification (design Alerts and notifications). Also the facts an
 * evaluation reads from a rule and an Issue before it can build an
 * AlertContext: the frequency windows to count over and the Issue's kind.
 *
 * Every attempt of one delivery carries the same delivery identity, fixed
 * by the firing or Incident Change it reports (design Outbound actions).
 */

import type { IssueId, ProjectId } from '../ids.js';
import type { AlertFiring } from './alert-firing.js';
import { digestSummaryLines, type Digest } from './digest.js';
import type { IssueAlertRule, IssueKind } from './issue-alert-rule.js';
import type { IncidentChange } from './metric-incident.js';
import type { WorkflowNotification } from './notification-settings.js';

/** What an alert says, identical on every attempt of one delivery. `issueId` is null for an Incident. */
export type AlertMessage = {
  readonly deliveryId: string;
  readonly projectId: ProjectId;
  readonly ruleId: string;
  readonly issueId: IssueId | null;
  readonly subject: string;
  readonly text: string;
};

/** A subject and body for one email. */
export type MailText = { readonly subject: string; readonly text: string };

/** The windows a rule's frequency triggers count over; null when it has none of that kind. */
export type FrequencyWindows = { readonly events: number | null; readonly users: number | null };

// --- helpers ---

function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

function widest(windows: readonly number[]): number | null {
  return windows.length === 0 ? null : Math.max(...windows);
}

function changeSummary(notification: WorkflowNotification): string {
  return notification.change.kind === 'comment' ? 'new comment' : `${notification.change.kind} changed`;
}

// --- exports: messages ---

export function alertMessageOf({ projectId, firing, title }: { projectId: ProjectId; firing: AlertFiring; title: string }): AlertMessage {
  return {
    deliveryId: `${firing.ruleId}:${firing.issueId}:${firing.at}`,
    projectId,
    ruleId: firing.ruleId,
    issueId: firing.issueId,
    subject: `Alert: ${title}`,
    text: `Issue Alert Rule ${firing.ruleId} fired for issue ${firing.issueId}: ${title}`,
  };
}

export function incidentMessageOf({ projectId, change }: { projectId: ProjectId; change: IncidentChange }): AlertMessage {
  const value = change.value === null ? 'by a member' : `at value ${change.value}`;
  return {
    deliveryId: `${change.ruleId}:incident:${change.at}`,
    projectId,
    ruleId: change.ruleId,
    issueId: null,
    subject: `Incident ${change.to}: ${change.ruleId}`,
    text: `Metric Alert Rule ${change.ruleId} went from ${change.from} to ${change.to} ${value}.`,
  };
}

/** The one email a Digest sends: every gathered Issue on its own line. */
export function digestMailOf(digest: Digest): MailText & { readonly to: string; readonly headers: Readonly<Record<string, string>> } {
  return {
    to: digest.recipient,
    subject: `${plural(digest.items.length, 'alert')} from rule ${digest.ruleId}`,
    text: digestSummaryLines(digest).join('\n'),
    headers: {},
  };
}

export function workflowMailOf(notification: WorkflowNotification): MailText {
  const { change } = notification;
  const summary = `Issue ${notification.issueId}: ${changeSummary(notification)}`;
  const detail = change.kind === 'comment' ? `${summary}.` : `${summary} from ${change.from ?? 'none'} to ${change.to ?? 'none'}.`;
  return { subject: summary, text: detail };
}

// --- exports: evaluation facts ---

export function frequencyWindows(rule: IssueAlertRule): FrequencyWindows {
  const events = rule.triggers.flatMap((trigger) => (trigger.kind === 'event_frequency' ? [trigger.windowMs] : []));
  const users = rule.triggers.flatMap((trigger) => (trigger.kind === 'user_frequency' ? [trigger.windowMs] : []));
  return { events: widest(events), users: widest(users) };
}

/** A Report issue holds no Fingerprint; any other Issue is a crash Issue. */
export function issueKindOf(fingerprintCount: number): IssueKind {
  return fingerprintCount === 0 ? 'report' : 'crash';
}
