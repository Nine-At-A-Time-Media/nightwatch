/**
 * Normalized Event -- one SDK event after validation and normalization
 * (design Processing, Normalization). Every part has one shape whatever the
 * SDK sent; a part that failed validation is absent and its removal is
 * recorded in `errors` by the path it had in the event as sent. Times are
 * epoch milliseconds after clock-drift correction. Values only.
 */

import type { Level } from '../issue/priority.js';

export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

/** One stack frame, oldest call first within its list, as SDKs send them. */
export type Frame = {
  readonly module?: string;
  readonly filename?: string;
  readonly absPath?: string;
  readonly function?: string;
  readonly inApp?: boolean;
  readonly lineno?: number;
  readonly colno?: number;
  readonly contextLine?: string;
};

export type Mechanism = { readonly type: string; readonly handled?: boolean; readonly synthetic?: boolean };

export type Exception = {
  readonly type: string | null;
  readonly value: string | null;
  readonly module?: string;
  readonly mechanism?: Mechanism;
  readonly frames: readonly Frame[];
};

export type Message = { readonly formatted: string | null; readonly template: string | null; readonly params: readonly string[] };

export type User = { readonly id?: string; readonly email?: string; readonly ipAddress?: string; readonly username?: string };

export type Request = { readonly url?: string; readonly method?: string; readonly headers: Readonly<Record<string, string>> };

export type Sdk = { readonly name: string; readonly version: string };

export type Breadcrumb = {
  readonly timestamp: number | null;
  readonly type?: string;
  readonly category?: string;
  readonly message?: string;
  readonly level?: string;
  readonly data?: JsonObject;
};

/** An image the SDK names in debug_meta; a `sourcemap` image ties a bundle's URL to its debug id. */
export type DebugImage = { readonly type: string; readonly debugId?: string; readonly codeFile?: string };

/**
 * Why a part of an Event is not as it was sent: dropped as invalid or too
 * long, a time clamped, or a frame left minified for want of a source map.
 */
export type EventErrorReason = 'invalid' | 'too-long' | 'clamped' | 'missing-artifact' | 'no-mapping';

export type EventError = { readonly path: string; readonly reason: EventErrorReason };

export type NormalizedEvent = {
  /** 32 lowercase hex digits. */
  readonly eventId: string;
  readonly projectId: string;
  readonly timestamp: number;
  readonly receivedAt: number;
  readonly level: Level;
  readonly platform: string;
  readonly message: Message | null;
  /** The exception chain in the order the SDK sent it. */
  readonly exceptions: readonly Exception[];
  /** A stack trace sent without an exception. */
  readonly stacktrace: readonly Frame[] | null;
  readonly release: string | null;
  readonly environment: string | null;
  readonly user: User | null;
  readonly tags: Readonly<Record<string, string>>;
  readonly contexts: Readonly<Record<string, JsonObject>>;
  readonly request: Request | null;
  readonly sdk: Sdk | null;
  readonly fingerprint: readonly string[] | null;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly extra: JsonObject;
  readonly serverName: string | null;
  readonly transaction: string | null;
  readonly logger: string | null;
  readonly debugImages: readonly DebugImage[];
  readonly errors: readonly EventError[];
};
