/**
 * Alert Firing -- one firing of an Issue Alert Rule for one Issue, with the
 * delivery of each of the rule's actions (design Alerts and notifications;
 * Behaviors: Undelivered alert is visible). An action is pending until its
 * Channel delivers it or Nightwatch stops trying; an undelivered action is
 * what Members see on the rule. Times are epoch milliseconds.
 */

import type { IssueId } from '../ids.js';
import type { Action, IssueAlertRule } from './issue-alert-rule.js';

export type DeliveryStatus = 'pending' | 'delivered' | 'undelivered';

export type ActionDelivery = { readonly action: Action; readonly status: DeliveryStatus };

export type AlertFiring = {
  readonly ruleId: string;
  readonly issueId: IssueId;
  readonly at: number;
  /** One per action of the rule, in the rule's order. */
  readonly deliveries: readonly ActionDelivery[];
};

// --- exports ---

export function alertFiring({ rule, issueId, at }: { rule: IssueAlertRule; issueId: IssueId; at: number }): AlertFiring {
  return { ruleId: rule.ruleId, issueId, at, deliveries: rule.actions.map((action) => ({ action, status: 'pending' })) };
}

/** Records the outcome of the action at `index`; an index the firing does not hold changes nothing. */
export function recordDelivery(firing: AlertFiring, index: number, status: DeliveryStatus): AlertFiring {
  if (index < 0 || index >= firing.deliveries.length) return firing;
  return { ...firing, deliveries: firing.deliveries.map((delivery, i) => (i === index ? { ...delivery, status } : delivery)) };
}

/** The actions Nightwatch stopped trying to deliver. */
export function undeliveredActions(firing: AlertFiring): readonly Action[] {
  return firing.deliveries.filter((delivery) => delivery.status === 'undelivered').map((delivery) => delivery.action);
}
