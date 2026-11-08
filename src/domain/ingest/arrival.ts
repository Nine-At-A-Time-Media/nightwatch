/**
 * Arrival and its ingest-side values (design Domain Language): the Arrival as
 * received, the Project config ingest reads, the Arrival Record it retains,
 * the ingest settings, and the values exchanged with QuotaGate and storage.
 */

import type { RequestParts } from '../protocol/credentials.js';
import type { DataCategory, RetryAdviceEntry } from '../protocol/retry-advice.js';
import type { Assertion } from '../signin/sign-in.js';
import type { InboundFilterConfig } from './inbound-filters.js';

export type EndpointKind = 'envelope' | 'store' | 'security' | 'attachment' | 'checkin';

/** One ingest request as received. `origin` is the browser's Origin, null for server SDKs. */
export type Arrival = RequestParts & {
  readonly projectId: string;
  readonly endpoint: EndpointKind;
  readonly origin: string | null;
  readonly body: Uint8Array;
};

export type ClientKey = { readonly publicKey: string; readonly active: boolean };

/** Event, Attachment and Arrival size limits, in bytes. */
export type SizeLimits = { readonly event: number; readonly attachment: number; readonly arrival: number };

/** What ingest reads about one Project. `allowedOrigins` of ['*'] admits any origin. */
export type ProjectConfig = {
  readonly clientKeys: readonly ClientKey[];
  readonly allowedOrigins: readonly string[];
  readonly sizeLimits: SizeLimits;
  readonly inboundFilters: InboundFilterConfig;
};

/**
 * Ingest settings, read once by the ingest composition root.
 * - streamRecordLimit: bytes; a larger body goes to the BlobStore first.
 * - retryAdviceCeilingSeconds: the Retry advice ceiling.
 * - unavailableRetrySeconds: Retry Advice given when storage is unavailable.
 */
export type IngestSettings = {
  readonly streamRecordLimit: number;
  readonly retryAdviceCeilingSeconds: number;
  readonly unavailableRetrySeconds: number;
};

/**
 * An admitted Arrival as retained, unprocessed: its body inline, or the
 * BlobStore key holding it. `assertion` is the sign-in Assertion the tunnel
 * route forwarded, kept only when a kept item is feedback, for the Report it
 * files; null otherwise.
 */
export type ArrivalRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly receivedAt: number;
  readonly endpoint: EndpointKind;
  readonly assertion: Assertion | null;
} & ({ readonly body: Uint8Array; readonly blobKey: null } | { readonly body: null; readonly blobKey: string });

/** Whether a write is durable; a failed write says whether retrying may succeed. */
export type Durability = { readonly ok: true } | { readonly ok: false; readonly retryable: boolean };

export type QuotaRequest = {
  readonly projectId: string;
  readonly publicKey: string;
  readonly category: DataCategory;
  readonly quantity: number;
};

export type QuotaDecision = { readonly allowed: true } | { readonly allowed: false; readonly advice: RetryAdviceEntry };
