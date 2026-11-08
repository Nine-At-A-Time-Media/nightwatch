/**
 * deliverAction -- the step evaluateIssueAlerts and evaluateMetricRule share:
 * one action of a rule delivered through the Channel of its kind (design
 * Alerts and notifications, Issue Alert Rule actions; Behaviors: Undelivered
 * alert is visible).
 *
 * An email action goes to the address of every Member it names; a webhook
 * action to its URL. A failure that retrying may fix is retried, with the
 * same Alert Message, up to the Delivery Attempts; after that, or after a
 * failure retrying cannot fix, Nightwatch stops trying and the action is
 * undelivered. An action that reaches nobody, or whose kind has no Channel,
 * is undelivered too. Opening a GitHub issue is the github Worker's work
 * through the Tracker, so that action stays pending here. Ports:
 * ControlStore, Channel.
 */

import type { DeliveryStatus } from '../../domain/alerts/alert-firing.js';
import type { AlertMessage } from '../../domain/alerts/alert-message.js';
import type { Action, EmailRecipient } from '../../domain/alerts/issue-alert-rule.js';
import type { ProjectId } from '../../domain/ids.js';
import type { Channel, Destination } from '../../ports/channel.js';
import type { ControlStore } from '../../ports/control-store.js';

/** How many times one delivery is attempted before Nightwatch stops trying; at least one. */
export type DeliverySettings = { readonly deliveryAttempts: number };

export type DeliverActionDeps = { control: ControlStore; channels: readonly Channel[]; settings: DeliverySettings };

// --- helpers ---

function statusOf(outcomes: readonly boolean[]): DeliveryStatus {
  return outcomes.length > 0 && outcomes.every((ok) => ok) ? 'delivered' : 'undelivered';
}

function emailDestinations(addresses: readonly string[]): Destination[] {
  return addresses.map((address) => ({ kind: 'email', address }));
}

// --- flow: one destination ---

async function deliverWithRetry(channel: Channel, destination: Destination, message: AlertMessage, attempts: number): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await channel.deliver(destination, message);
    if (result.ok) return true;
    if (!result.retryable) return false;
  }
  return false;
}

async function deliverTo(destination: Destination, message: AlertMessage, deps: DeliverActionDeps): Promise<boolean> {
  const channel = deps.channels.find((candidate) => candidate.kind === destination.kind);
  if (channel === undefined) return false;
  return deliverWithRetry(channel, destination, message, deps.settings.deliveryAttempts);
}

async function deliverAll(destinations: readonly Destination[], message: AlertMessage, deps: DeliverActionDeps): Promise<DeliveryStatus> {
  const outcomes: boolean[] = [];
  for (const destination of destinations) outcomes.push(await deliverTo(destination, message, deps));
  return statusOf(outcomes);
}

// --- exports ---

/** The addresses of the Members an email action names in the Project; Members with no address are skipped. */
export async function emailAddresses(scope: { projectId: ProjectId; to: EmailRecipient }, control: ControlStore): Promise<string[]> {
  const addresses: string[] = [];
  for (const member of await control.recipientsOf(scope)) {
    const address = await control.addressOf(member);
    if (address !== null) addresses.push(address);
  }
  return addresses;
}

export async function deliverAction(
  delivery: { projectId: ProjectId; action: Action; message: AlertMessage },
  deps: DeliverActionDeps,
): Promise<DeliveryStatus> {
  const { action, message } = delivery;
  switch (action.kind) {
    case 'webhook':
      return deliverAll([{ kind: 'webhook', url: action.url }], message, deps);
    case 'email':
      return deliverAll(
        emailDestinations(await emailAddresses({ projectId: delivery.projectId, to: action.to }, deps.control)),
        message,
        deps,
      );
    case 'open_github_issue':
      return 'pending';
  }
}
