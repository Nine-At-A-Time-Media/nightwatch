/**
 * Channel -- the seam for alert delivery (architecture Seams: Alert
 * channel). Email over the Mailer and webhooks over `fetch` today; Slack or
 * PagerDuty later. A Channel delivers one Alert Message to one Destination
 * of its own kind; a Destination of another kind is refused without retry.
 * A failed delivery says whether retrying may succeed.
 *
 * Every attempt of one delivery carries the same `deliveryId`, so a
 * receiver can tell a repeat from a new delivery (design Alerts and
 * notifications, Outbound actions).
 */

import type { IssueId, ProjectId } from '../domain/ids.js';
import type { Durability } from '../domain/ingest/arrival.js';

/** Where one action's message goes: a resolved email address, or a webhook URL. */
export type Destination = { readonly kind: 'email'; readonly address: string } | { readonly kind: 'webhook'; readonly url: string };

export type ChannelKind = Destination['kind'];

/** What an Issue Alert Rule's firing says, identical on every attempt of one delivery. */
export type AlertMessage = {
  readonly deliveryId: string;
  readonly projectId: ProjectId;
  readonly ruleId: string;
  readonly issueId: IssueId;
  readonly subject: string;
  readonly text: string;
};

export interface Channel {
  readonly kind: ChannelKind;
  deliver(destination: Destination, message: AlertMessage): Promise<Durability>;
}
