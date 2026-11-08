/**
 * Ownership facts -- what ownership reads of one Event (design Issues,
 * Ownership; Code and GitHub, Suspect commit): the stack frames of the
 * exception raised last (or the stack trace sent without one), oldest call
 * first, with each frame's path, module, line and in-app flag; the request
 * URL; and the tags. Built from the Normalized Event after scrubbing, so it
 * holds no value a Scrubbing Rule removed. A frame's path is its file name,
 * else its absolute path. The same facts can be read back from the Event as
 * processing stored it, for suggesting owners after the fact.
 */

import type { EventSummary } from '../event/event-summary.js';
import { z } from 'zod';
import type { NormalizedEvent } from '../normalize/normalized-event.js';

export type OwnershipFrame = {
  readonly path: string | null;
  readonly module: string | null;
  readonly lineno: number | null;
  readonly inApp: boolean;
};

export type OwnershipFacts = {
  readonly frames: readonly OwnershipFrame[];
  readonly url: string | null;
  readonly tags: Readonly<Record<string, string>>;
};

/** An Event Summary with the ownership facts of its Event, which the Summary alone does not carry. */
export type OwnedEventSummary = EventSummary & { readonly ownership: OwnershipFacts };

/** A frame as ownership reads it, from a Normalized Event or a stored one. */
type FactFrame = {
  readonly filename?: string | undefined;
  readonly absPath?: string | undefined;
  readonly module?: string | undefined;
  readonly lineno?: number | undefined;
  readonly inApp?: boolean | undefined;
};

/** The parts of an Event ownership reads. */
type FactParts = {
  readonly exceptions: readonly { readonly frames: readonly FactFrame[] }[];
  readonly stacktrace: readonly FactFrame[] | null;
  readonly request: { readonly url?: string | undefined } | null;
  readonly tags: Readonly<Record<string, string>>;
};

const FrameShape = z.object({
  filename: z.string().optional(),
  absPath: z.string().optional(),
  module: z.string().optional(),
  lineno: z.number().optional(),
  inApp: z.boolean().optional(),
});

/** The stored Event's parts ownership reads (encodeScrubbedEvent's format). */
const StoredEventShape = z.object({
  event: z.object({
    exceptions: z.array(z.object({ frames: z.array(FrameShape) })),
    stacktrace: z.array(FrameShape).nullable(),
    request: z.object({ url: z.string().optional() }).nullable(),
    // Kept as sent: a record parse would drop a tag named like a prototype key.
    tags: z.custom<Readonly<Record<string, string>>>(isStringRecord),
  }),
});

// --- predicates ---

function isStringRecord(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string')
  );
}

// --- helpers ---

function frameOf(frame: FactFrame): OwnershipFrame {
  return {
    path: frame.filename ?? frame.absPath ?? null,
    module: frame.module ?? null,
    lineno: frame.lineno ?? null,
    inApp: frame.inApp === true,
  };
}

function factsOf(event: FactParts): OwnershipFacts {
  const frames = event.exceptions.at(-1)?.frames ?? event.stacktrace ?? [];
  return { frames: frames.map(frameOf), url: event.request?.url ?? null, tags: event.tags };
}

function storedJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// --- exports ---

export function ownershipFactsOf(event: NormalizedEvent): OwnershipFacts {
  return factsOf(event);
}

/** The ownership facts of an Event as processing stored it; null when the bytes hold no stored Event. */
export function storedOwnershipFacts(bytes: Uint8Array): OwnershipFacts | null {
  const parsed = StoredEventShape.safeParse(storedJson(bytes));
  return parsed.success ? factsOf(parsed.data.event) : null;
}
