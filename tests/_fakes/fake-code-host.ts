/**
 * FakeCodeHost -- an in-memory CodeHost. Tests put files, each with its text
 * and its blame ranges, at a Repository, path and ref; reads answer from
 * them. Every call is recorded for assertions. `refusing` makes every call
 * refuse with it, as the host would when it denies a read.
 */

import { commitOfLine, type BlamedCommit, type BlameRange } from '../../src/domain/ownership/suspect-commit.js';
import { refusal, type Refusal } from '../../src/domain/refusal.js';
import type { Repository } from '../../src/domain/tracker/external-link.js';
import type { CodeHost, CodeLocation } from '../../src/ports/code-host.js';

export type HostedFile = {
  readonly repository: Repository;
  readonly path: string;
  readonly ref: string;
  readonly text: string;
  readonly blame: readonly BlameRange[];
};

export type CodeHostCall =
  { readonly kind: 'blame'; readonly at: CodeLocation & { line: number } } | { readonly kind: 'fileText'; readonly at: CodeLocation };

const NOT_FOUND = refusal('code_not_found');

function keyOf(at: CodeLocation): string {
  return `${at.repository}@${at.ref}:${at.path}`;
}

export class FakeCodeHost implements CodeHost {
  readonly calls: CodeHostCall[] = [];
  refusing: Refusal | null = null;
  readonly #files = new Map<string, HostedFile>();

  putFile(file: HostedFile): void {
    this.#files.set(keyOf(file), file);
  }

  async blame(at: CodeLocation & { readonly line: number }): Promise<BlamedCommit | Refusal> {
    this.calls.push({ kind: 'blame', at });
    if (this.refusing) return this.refusing;
    const file = this.#files.get(keyOf(at));
    return (file && commitOfLine(file.blame, at.line)) ?? NOT_FOUND;
  }

  async fileText(at: CodeLocation): Promise<string | Refusal> {
    this.calls.push({ kind: 'fileText', at });
    if (this.refusing) return this.refusing;
    return this.#files.get(keyOf(at))?.text ?? NOT_FOUND;
  }
}
