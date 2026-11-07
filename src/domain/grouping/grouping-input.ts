/**
 * Grouping Input -- what Fingerprint derivation reads from a normalized
 * Event: the exception chain, the stack trace, the message, and the few
 * event attributes that Fingerprint Rules can match. Values only.
 */

export type GroupingFrame = {
  readonly module?: string;
  readonly filename?: string;
  readonly absPath?: string;
  readonly function?: string;
  readonly inApp?: boolean;
  readonly lineno?: number;
  readonly colno?: number;
  readonly contextLine?: string;
};

/** How the exception was captured. A synthetic mechanism means its type and value were made up by the SDK, not thrown by the program. */
export type GroupingMechanism = { readonly type: string; readonly synthetic?: boolean };

export type GroupingException = {
  readonly type: string | null;
  readonly value: string | null;
  readonly mechanism?: GroupingMechanism;
  readonly frames: readonly GroupingFrame[];
};

export type GroupingMessage = {
  readonly formatted: string | null;
  readonly template: string | null;
  readonly params: readonly string[];
};

export type GroupingInput = {
  /** The exception chain in the order the SDK sent it. */
  readonly exceptions: readonly GroupingException[];
  /** A stack trace sent without an exception, such as a thread's. */
  readonly stacktrace: readonly GroupingFrame[] | null;
  readonly message: GroupingMessage | null;
  readonly platform: string;
  /** The SDK-supplied fingerprint values, if any. */
  readonly fingerprint: readonly string[] | null;
  readonly logger: string | null;
  readonly level: string | null;
  readonly tags: Readonly<Record<string, string>>;
};
