/**
 * External Link -- the tie between an Issue and a GitHub issue, and its
 * place in State Machine: External Link (Linked, Broken, or none).
 *
 * A link remembers the GitHub issue's last known state, and the state
 * Nightwatch last pushed and has not yet seen reported back (`expected`),
 * which is what the no-echo rule matches an inbound change against. A push
 * GitHub refuses counts toward the link becoming Broken; the bound is a
 * parameter the caller supplies, and a success starts the count again. A
 * Broken link takes no sync in either direction until a member relinks it.
 */

import { refusal, type Refusal } from '../refusal.js';

/** A code repository an Organization connected, named `owner/name`. */
export type Repository = string;

/** Why a GitHub issue was closed. */
export type CloseReason = 'completed' | 'not_planned';

/** A GitHub issue's state, as Nightwatch knows it or expects it. */
export type TrackerState = { readonly state: 'open' } | { readonly state: 'closed'; readonly reason: CloseReason };

export type ExternalLink = {
  readonly issueId: string;
  readonly repository: Repository;
  /** The GitHub issue's number within its Repository. */
  readonly number: number;
  readonly state: 'linked' | 'broken';
  readonly lastKnown: TrackerState;
  /** The state Nightwatch last pushed and has not yet seen reported back; null when none is pending. */
  readonly expected: TrackerState | null;
  /** Consecutive pushes GitHub refused. */
  readonly refusals: number;
};

export type LinkFields = {
  readonly issueId: string;
  readonly repository: Repository;
  readonly number: number;
  readonly lastKnown: TrackerState;
};

const NOT_ALLOWED = refusal('transition_not_allowed');

// --- predicates ---

export function isSameTrackerState(a: TrackerState, b: TrackerState): boolean {
  if (a.state === 'open' || b.state === 'open') return a.state === b.state;
  return a.reason === b.reason;
}

function isBroken(externalLink: ExternalLink): boolean {
  return externalLink.state === 'broken';
}

// --- exports ---

/** (none) to Linked: an issue opened or linked on GitHub. */
export function link(fields: LinkFields): ExternalLink {
  return { ...fields, state: 'linked', expected: null, refusals: 0 };
}

/** Linked to Linked: records the state about to be pushed, before the write, so its echo is recognised. */
export function expectPushed(externalLink: ExternalLink, expected: TrackerState): ExternalLink {
  return isBroken(externalLink) ? externalLink : { ...externalLink, expected };
}

/** Linked to Linked: GitHub accepted the push; the expected state is now the last known one. */
export function pushSucceeded(externalLink: ExternalLink): ExternalLink {
  if (isBroken(externalLink)) return externalLink;
  return { ...externalLink, lastKnown: externalLink.expected ?? externalLink.lastKnown, refusals: 0 };
}

/** Linked to Linked: GitHub accepted a comment; the refusal count starts again and the GitHub state is untouched. */
export function commentPosted(externalLink: ExternalLink): ExternalLink {
  return isBroken(externalLink) ? externalLink : { ...externalLink, refusals: 0 };
}

/** Linked to Linked, or to Broken once refusals reach `maxRefusals` (at least one). */
export function pushRefused(externalLink: ExternalLink, bound: { readonly maxRefusals: number }): ExternalLink {
  if (isBroken(externalLink)) return externalLink;
  const refusals = externalLink.refusals + 1;
  return { ...externalLink, refusals, state: refusals >= bound.maxRefusals ? 'broken' : 'linked' };
}

/** Linked to Linked: GitHub reported a state; it clears the expectation it matches, and no other. */
export function observe(externalLink: ExternalLink, observed: TrackerState): ExternalLink {
  if (isBroken(externalLink)) return externalLink;
  const { expected } = externalLink;
  const consumed = expected !== null && isSameTrackerState(expected, observed);
  return { ...externalLink, lastKnown: observed, expected: consumed ? null : expected };
}

/** Linked to Broken: the installation or the Repository was removed. */
export function markBroken(externalLink: ExternalLink): ExternalLink {
  return isBroken(externalLink) ? externalLink : { ...externalLink, state: 'broken' };
}

/** Broken to Linked: the installation is restored and a member relinks; nothing stays pending. */
export function relink(externalLink: ExternalLink, current: { readonly lastKnown: TrackerState }): ExternalLink | Refusal {
  if (!isBroken(externalLink)) return NOT_ALLOWED;
  return { ...externalLink, state: 'linked', lastKnown: current.lastKnown, expected: null, refusals: 0 };
}

/** Linked to (none): a member unlinks. */
export function unlink(externalLink: ExternalLink): null | Refusal {
  return isBroken(externalLink) ? NOT_ALLOWED : null;
}
