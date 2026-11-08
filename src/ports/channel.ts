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

import type { AlertMessage } from '../domain/alerts/alert-message.js';
import type { Durability } from '../domain/ingest/arrival.js';

export type { AlertMessage };

/** Where one action's message goes: a resolved email address, or a webhook URL. */
export type Destination = { readonly kind: 'email'; readonly address: string } | { readonly kind: 'webhook'; readonly url: string };

export type ChannelKind = Destination['kind'];

export interface Channel {
  readonly kind: ChannelKind;
  deliver(destination: Destination, message: AlertMessage): Promise<Durability>;
}
