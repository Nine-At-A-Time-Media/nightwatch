/**
 * Triage actions -- every command a Member applies to one Issue from the
 * console (design State Machine: Issue, the rows a member triggers; Issues,
 * Lifecycle, Priority, Inbox), as one value. `triage` dispatches an action to
 * the issue command of the same name, which owns the transition rules;
 * `parseTriageAction` reads an action from a request body.
 *
 * A Member resolves plainly, in a named release, or in the next release
 * (pending until that release is first seen). Resolving in a commit is the
 * commit's own path, and archiving as spam is the Spam Judge's, so neither
 * is a triage action.
 */

import { z } from 'zod';
import { refusal, type Refusal } from '../refusal.js';
import { archive, markReviewed, resolve, setPriority, unarchive, unresolve, type ArchiveVariant } from './commands.js';
import type { PriorityLevel } from './priority.js';
import type { Resolution } from './resolution.js';
import type { Actor, IssueState, IssueTransition } from './state.js';

/** How a Member resolves an Issue. */
export type TriageResolution =
  { readonly kind: 'plain' } | { readonly kind: 'in_release'; readonly release: string } | { readonly kind: 'in_next_release' };

/** How a Member archives an Issue: as ArchiveVariant, but forever never means spam. */
export type TriageArchive = Exclude<ArchiveVariant, { substatus: 'forever' }> | { readonly substatus: 'forever' };

export type TriageAction =
  | { readonly kind: 'resolve'; readonly resolution: TriageResolution }
  | { readonly kind: 'archive'; readonly archive: TriageArchive }
  | { readonly kind: 'unarchive' }
  | { readonly kind: 'unresolve' }
  | { readonly kind: 'set_priority'; readonly level: PriorityLevel }
  | { readonly kind: 'mark_reviewed' };

const INVALID = refusal('invalid_triage_action');

const optionalAmount = z.number().nonnegative().nullable();

const TriageActionShape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resolve'),
    resolution: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('plain') }),
      z.object({ kind: z.literal('in_release'), release: z.string().min(1) }),
      z.object({ kind: z.literal('in_next_release') }),
    ]),
  }),
  z.object({
    kind: z.literal('archive'),
    archive: z.discriminatedUnion('substatus', [
      z.object({ substatus: z.literal('until_escalating') }),
      z.object({
        substatus: z.literal('until_condition'),
        condition: z.object({
          untilDate: optionalAmount,
          count: optionalAmount,
          window: optionalAmount,
          userCount: optionalAmount,
          userWindow: optionalAmount,
        }),
      }),
      z.object({ substatus: z.literal('forever') }),
    ]),
  }),
  z.object({ kind: z.literal('unarchive') }),
  z.object({ kind: z.literal('unresolve') }),
  z.object({ kind: z.literal('set_priority'), level: z.enum(['low', 'medium', 'high']) }),
  z.object({ kind: z.literal('mark_reviewed') }),
]);

// --- helpers ---

function resolutionOf(resolution: TriageResolution): Resolution {
  return resolution.kind === 'in_next_release' ? { kind: 'in_next_release', release: null } : resolution;
}

function archiveVariantOf(variant: TriageArchive): ArchiveVariant {
  return variant.substatus === 'forever' ? { substatus: 'forever', spam: false } : variant;
}

// --- exports ---

/** Applies a Member's triage action: the next state and its Issue Changes, or a Refusal. */
export function triage(state: IssueState, action: TriageAction, actor: Actor, at: number): IssueTransition | Refusal {
  switch (action.kind) {
    case 'resolve':
      return resolve(state, resolutionOf(action.resolution), actor, at);
    case 'archive':
      return archive(state, archiveVariantOf(action.archive), actor, at);
    case 'unarchive':
      return unarchive(state, actor, at);
    case 'unresolve':
      return unresolve(state, actor, at);
    case 'set_priority':
      return setPriority(state, action.level, actor, at);
    case 'mark_reviewed':
      return markReviewed(state, actor, at);
  }
}

/** A triage action from its JSON form, or the `invalid_triage_action` Refusal. */
export function parseTriageAction(input: unknown): TriageAction | Refusal {
  const parsed = TriageActionShape.safeParse(input);
  return parsed.success ? parsed.data : INVALID;
}
