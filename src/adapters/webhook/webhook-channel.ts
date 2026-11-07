/**
 * WebhookChannel -- the Channel for webhook Destinations: one POST of the
 * Alert Message as JSON, with the delivery's identity in the
 * `X-Nightwatch-Delivery` header (design Alerts and notifications, Outbound
 * actions). `fetch` is injected. A 2xx answer is delivered; a 408, 429 or
 * 5xx answer, or a network failure, may succeed on retry; any other answer
 * will not.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import type { AlertMessage, Channel, Destination } from '../../ports/channel.js';

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const DELIVERY_HEADER = 'X-Nightwatch-Delivery';

const REFUSED: Durability = { ok: false, retryable: false };

// --- predicates ---

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// --- helpers ---

function durabilityOf(response: Response): Durability {
  return response.ok ? { ok: true } : { ok: false, retryable: isRetryableStatus(response.status) };
}

function requestOf(message: AlertMessage): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', [DELIVERY_HEADER]: message.deliveryId },
    body: JSON.stringify(message),
  };
}

// --- exports ---

export class WebhookChannel implements Channel {
  readonly kind = 'webhook';
  readonly #fetch: Fetcher;

  constructor(fetcher: Fetcher) {
    this.#fetch = fetcher;
  }

  async deliver(destination: Destination, message: AlertMessage): Promise<Durability> {
    if (destination.kind !== 'webhook') return REFUSED;
    try {
      return durabilityOf(await this.#fetch(destination.url, requestOf(message)));
    } catch {
      return { ok: false, retryable: true };
    }
  }
}
