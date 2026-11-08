/**
 * Resolution and Regression Policy -- how an Issue was resolved, and whether
 * a new Event regresses it (design Issues, Regression; Domain Language).
 *
 * - plain: any new Event regresses it.
 * - in_release R: an Event regresses it only from a release newer than R.
 *   An Event that carries no release regresses it, since nothing shows it
 *   comes from a fixed build.
 * - in_next_release, in_commit: pending until a release is named (the next
 *   release first seen, or the release the commit ships in). A pending
 *   Resolution never regresses: the fix has not shipped, so Events from
 *   current builds are expected. Once named, it behaves as in_release.
 */

import { compareReleases, type Release, type ReleaseFirstSeen } from '../release/ordering.js';

export type Resolution =
  | { readonly kind: 'plain' }
  | { readonly kind: 'in_release'; readonly release: Release }
  | { readonly kind: 'in_next_release'; readonly release: Release | null }
  | {
      readonly kind: 'in_commit';
      /** The Commit's identity (repository and hash, as the caller keys it). */
      readonly commit: string;
      readonly release: Release | null;
    };

// --- predicates ---

export function isPendingResolution(resolution: Resolution): boolean {
  return (resolution.kind === 'in_next_release' || resolution.kind === 'in_commit') && resolution.release === null;
}

// --- helpers ---

/** The History label of a Resolution: `plain`, `in_release:1.2.0`, `in_next_release`, `in_commit:abc:1.2.0`. */
export function resolutionLabel(resolution: Resolution): string {
  if (resolution.kind === 'plain') return resolution.kind;
  const parts = resolution.kind === 'in_commit' ? [resolution.kind, resolution.commit] : [resolution.kind];
  return [...parts, ...(resolution.release === null ? [] : [resolution.release])].join(':');
}

/** The Regression Policy. */
export function isRegression(resolution: Resolution, eventRelease: Release | null, firstSeen: ReleaseFirstSeen): boolean {
  if (resolution.kind === 'plain') return true;
  if (resolution.release === null) return false;
  if (eventRelease === null) return true;
  return compareReleases(eventRelease, resolution.release, firstSeen) > 0;
}
