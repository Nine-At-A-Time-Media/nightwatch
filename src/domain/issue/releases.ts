/**
 * Releases and pending Resolutions -- a Resolution waiting for a release
 * names it when the release appears (design Behaviors: Resolve in next
 * release; Code and GitHub, Resolve by reference). A resolved-in-next-release
 * Issue takes the first release seen after it was resolved; a commit
 * Resolution takes the release its commit ships in. Either is named once.
 */

import type { Release } from '../release/ordering.js';
import { resolutionLabel, type Resolution } from './resolution.js';
import { change, unchanged, type Actor, type IssueState, type IssueTransition } from './state.js';

// --- helpers ---

function nameRelease(state: IssueState, resolution: Resolution, actor: Actor, at: number): IssueTransition {
  if (state.status !== 'resolved') return unchanged(state);
  return {
    state: { ...state, resolution },
    changes: [change(state, { kind: 'resolution', from: resolutionLabel(state.resolution), to: resolutionLabel(resolution), actor, at })],
  };
}

// --- exports ---

/** A release first seen names the pending next-release Resolution of a resolved Issue. */
export function recordReleaseSeen(state: IssueState, release: Release, at: number): IssueTransition {
  if (state.status !== 'resolved' || state.resolution.kind !== 'in_next_release' || state.resolution.release !== null)
    return unchanged(state);
  return nameRelease(state, { kind: 'in_next_release', release }, 'system', at);
}

/** A commit shipping in a release names that release in the pending Resolution that waits for that commit. */
export function recordCommitShipped(state: IssueState, shipped: { commit: string; release: Release }, at: number): IssueTransition {
  if (state.status !== 'resolved' || state.resolution.kind !== 'in_commit') return unchanged(state);
  if (state.resolution.commit !== shipped.commit || state.resolution.release !== null) return unchanged(state);
  return nameRelease(state, { kind: 'in_commit', commit: shipped.commit, release: shipped.release }, 'commit', at);
}
