/**
 * Code Mapping -- the tie between a stack path prefix and a repository path
 * (design Code and GitHub, Code links; Domain Language: Code Mapping). A
 * stack path that starts with a mapping's stack root becomes a path in its
 * repository by putting the source root in place of the stack root. When
 * several stack roots match, the longest wins. Repository paths are relative
 * to the repository root: no leading `/` and no `./` segments.
 */

import type { Repository } from '../tracker/external-link.js';

export type CodeMapping = {
  readonly repository: Repository;
  readonly stackRoot: string;
  readonly sourceRoot: string;
  /** The branch or other ref files are read at. */
  readonly ref: string;
};

export type RepositoryPath = { readonly mapping: CodeMapping; readonly path: string };

// --- helpers ---

function repositoryRelative(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
}

// --- exports ---

/** Where a stack path lives in a repository, through the longest matching Code Mapping; null when none matches. */
export function repositoryPathOf(mappings: readonly CodeMapping[], stackPath: string): RepositoryPath | null {
  const mapping = mappings
    .filter((candidate) => stackPath.startsWith(candidate.stackRoot))
    .reduce<CodeMapping | null>(
      (longest, candidate) => (longest === null || candidate.stackRoot.length > longest.stackRoot.length ? candidate : longest),
      null,
    );
  if (mapping === null) return null;
  return { mapping, path: repositoryRelative(`${mapping.sourceRoot}/${stackPath.slice(mapping.stackRoot.length)}`) };
}
