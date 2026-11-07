/**
 * CodeHost -- the seam for reading a connected repository (architecture
 * Seams: Code host). The GitHub App adapter in production (GraphQL blame,
 * the contents API for CODEOWNERS), an in-memory fake in tests; GitLab is
 * the second mechanism. Paths are relative to the repository root; `ref` is
 * a branch, tag or commit.
 *
 * Every call returns a Refusal instead of throwing: `code_not_found` when
 * the repository, ref, file or line is not there, `code_refused` when the
 * host refuses, `code_unreachable` when it cannot be reached.
 */

import type { BlamedCommit } from '../domain/ownership/suspect-commit.js';
import type { Refusal } from '../domain/refusal.js';
import type { Repository } from '../domain/tracker/external-link.js';

export type CodeLocation = { readonly repository: Repository; readonly path: string; readonly ref: string };

export interface CodeHost {
  /** The commit that last changed the line (from 1) of the file at the ref. */
  blame(at: CodeLocation & { readonly line: number }): Promise<BlamedCommit | Refusal>;
  /** The file's text at the ref. */
  fileText(at: CodeLocation): Promise<string | Refusal>;
}
