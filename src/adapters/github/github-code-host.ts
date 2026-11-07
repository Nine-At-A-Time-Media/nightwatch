/**
 * GitHubCodeHost -- the CodeHost backed by a GitHub App (architecture Seams:
 * Code host; Mechanism, Code and GitHub: suspect commits use the GitHub
 * GraphQL blame). Blame asks GraphQL for the blame ranges of the file at the
 * ref and picks the range holding the line; file text comes from the
 * contents API, base64-decoded as UTF-8. Each call acts as the App's
 * installation on the Repository's owner, through GitHubApp. `fetch` and the
 * clock are injected, so tests reach no network. 404, a missing ref, file
 * or line, and a GraphQL answer naming no blame are `code_not_found`; any
 * other refusal is `code_refused`; a request that cannot be made is
 * `code_unreachable`.
 */

import { z } from 'zod';
import { commitOfLine, type BlamedCommit, type BlameRange } from '../../domain/ownership/suspect-commit.js';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { CodeHost, CodeLocation } from '../../ports/code-host.js';
import { GitHubApp, type GitHubAppOptions } from './github-app.js';

export type GitHubCodeHostOptions = GitHubAppOptions;

const NOT_FOUND = refusal('code_not_found');
const REFUSALS = { notFound: NOT_FOUND, refused: refusal('code_refused'), unreachable: refusal('code_unreachable') };

const BLAME_QUERY = `query Blame($owner: String!, $name: String!, $ref: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $ref) {
      ... on Commit {
        blame(path: $path) {
          ranges { startingLine endingLine commit { oid committedDate author { email user { login } } } }
        }
      }
    }
  }
}`;

const RangeShape = z.object({
  startingLine: z.number().int(),
  endingLine: z.number().int(),
  commit: z.object({
    oid: z.string(),
    committedDate: z.string(),
    author: z.object({ email: z.string().nullish(), user: z.object({ login: z.string() }).nullish() }).nullish(),
  }),
});

const BlameShape = z.object({
  data: z
    .object({
      repository: z.object({ object: z.object({ blame: z.object({ ranges: z.array(RangeShape) }).nullish() }).nullish() }).nullish(),
    })
    .nullish(),
});

const ContentShape = z.object({ type: z.literal('file'), encoding: z.literal('base64'), content: z.string() });

// --- helpers ---

function rangeOf(range: z.infer<typeof RangeShape>): BlameRange {
  const { commit } = range;
  const author = { email: commit.author?.email || null, login: commit.author?.user?.login ?? null };
  const blamed: BlamedCommit = { hash: commit.oid, author, at: Date.parse(commit.committedDate) };
  return { startingLine: range.startingLine, endingLine: range.endingLine, commit: blamed };
}

function rangesOf(answer: z.infer<typeof BlameShape>): readonly BlameRange[] | null {
  return answer.data?.repository?.object?.blame?.ranges.map(rangeOf) ?? null;
}

function decodeBase64(content: string): string {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function contentsPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// --- exports ---

export class GitHubCodeHost implements CodeHost {
  readonly #app: GitHubApp;

  constructor(options: GitHubCodeHostOptions) {
    this.#app = new GitHubApp(options, REFUSALS);
  }

  async blame(at: CodeLocation & { readonly line: number }): Promise<BlamedCommit | Refusal> {
    const answer = await this.#app.asInstallation(
      at.repository,
      (parts) => ({
        method: 'POST',
        path: '/graphql',
        body: { query: BLAME_QUERY, variables: { owner: parts.owner, name: parts.name, ref: at.ref, path: at.path } },
      }),
      BlameShape,
    );
    if (isRefusal(answer)) return answer;
    const ranges = rangesOf(answer);
    return (ranges && commitOfLine(ranges, at.line)) ?? NOT_FOUND;
  }

  async fileText(at: CodeLocation): Promise<string | Refusal> {
    const file = await this.#app.asInstallation(
      at.repository,
      (parts) => ({
        method: 'GET',
        path: `/repos/${parts.owner}/${parts.name}/contents/${contentsPath(at.path)}?ref=${encodeURIComponent(at.ref)}`,
      }),
      ContentShape,
    );
    return isRefusal(file) ? file : decodeBase64(file.content);
  }
}
