/**
 * Commit -- a change recorded in a connected Repository (design Code and
 * GitHub, Commits; Resolve by reference). Commits reach Nightwatch from push
 * events and merged pull requests, or from the range between two releases;
 * a Commit known to ship in a Release names it. A pending commit Resolution
 * keys the Commit by Repository and hash.
 */

import type { Repository } from '../tracker/external-link.js';
import type { Release } from './ordering.js';

export type Commit = {
  readonly repository: Repository;
  readonly hash: string;
  /** The commit message, or a merged pull request's title and body. */
  readonly message: string;
  /** The Release the Commit ships in; null while none is known. */
  readonly release: Release | null;
};

// --- exports ---

/** The Commit's identity in a commit Resolution: `owner/name@hash`. */
export function commitKey(commit: Pick<Commit, 'repository' | 'hash'>): string {
  return `${commit.repository}@${commit.hash}`;
}
