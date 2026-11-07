/**
 * Ownership facts -- what ownership reads of one Event (design Issues,
 * Ownership; Code and GitHub, Suspect commit): the stack frames of the
 * exception raised last (or the stack trace sent without one), oldest call
 * first, with each frame's path, module, line and in-app flag; the request
 * URL; and the tags. Built from the Normalized Event after scrubbing, so it
 * holds no value a Scrubbing Rule removed. A frame's path is its file name,
 * else its absolute path.
 */

import type { EventSummary } from '../event/event-summary.js';
import type { Frame, NormalizedEvent } from '../normalize/normalized-event.js';

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

// --- helpers ---

function frameOf(frame: Frame): OwnershipFrame {
  return {
    path: frame.filename ?? frame.absPath ?? null,
    module: frame.module ?? null,
    lineno: frame.lineno ?? null,
    inApp: frame.inApp === true,
  };
}

// --- exports ---

export function ownershipFactsOf(event: NormalizedEvent): OwnershipFacts {
  const frames = event.exceptions.at(-1)?.frames ?? event.stacktrace ?? [];
  return { frames: frames.map(frameOf), url: event.request?.url ?? null, tags: event.tags };
}
