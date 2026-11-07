/**
 * GitHubTracker -- the Tracker backed by a GitHub App's REST API
 * (architecture Seams: Issue tracker; Mechanism, Code and GitHub).
 *
 * Each call acts as the App's installation on the Repository's owner. An
 * installation token is minted with a short-lived App JWT (RS256, signed with
 * the App key from settings, PKCS#8 PEM), and kept in the TokenCache until
 * shortly before it expires. `fetch` and the clock are injected, so tests
 * reach no network. Every failure becomes a Refusal: 404 is
 * `tracker_not_found`, any other refusal `tracker_refused`, and a request
 * that cannot be made `tracker_unreachable`.
 */

import { importPKCS8, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';
import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import type { CloseReason, Repository, TrackerState } from '../../domain/tracker/external-link.js';
import type { Clock } from '../../ports/clock.js';
import type { Tracker, TrackerIssueDraft, TrackerIssueRef } from '../../ports/tracker.js';
import type { TokenCache } from './token-cache.js';

export type GitHubTrackerOptions = {
  readonly appId: string;
  /** The App's private key as a PKCS#8 PEM. */
  readonly privateKey: string;
  readonly fetch: typeof fetch;
  readonly tokens: TokenCache;
  readonly clock: Clock;
  /** The REST API origin; GitHub's public API unless set. */
  readonly apiBaseUrl?: string;
};

type Call = { readonly method: string; readonly path: string; readonly body?: unknown };

const API = 'https://api.github.com';
const ALGORITHM = 'RS256';
/** A token this close to expiry is minted afresh. */
const REFRESH_MARGIN = 5 * 60_000;
/** The App JWT is backdated against clock skew and lives under GitHub's ten-minute limit. */
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const REPOSITORY_NAME = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'nightwatch' };

const NOT_FOUND = refusal('tracker_not_found');
const REFUSED = refusal('tracker_refused');
const UNREACHABLE = refusal('tracker_unreachable');

const IssueShape = z.object({ number: z.number().int(), state: z.enum(['open', 'closed']), state_reason: z.string().nullish() });
const CommentShape = z.object({ id: z.number().int() });
const InstallationShape = z.object({ id: z.number().int() });
const TokenShape = z.object({ token: z.string(), expires_at: z.string() });

// --- helpers ---

/** The owner and name of a Repository, or null when it is not `owner/name`. */
function partsOf(repository: Repository): { owner: string; name: string } | null {
  const match = REPOSITORY_NAME.exec(repository);
  if (!match?.[1] || !match[2] || match[1] === '..' || match[2] === '..') return null;
  return { owner: match[1], name: match[2] };
}

function stateOf(issue: z.infer<typeof IssueShape>): TrackerState {
  if (issue.state === 'open') return { state: 'open' };
  const reason: CloseReason = issue.state_reason === 'not_planned' ? 'not_planned' : 'completed';
  return { state: 'closed', reason };
}

function refusalOf(status: number): Refusal {
  return status === 404 ? NOT_FOUND : REFUSED;
}

/** A token that cannot be minted refuses the call, unless GitHub could not be reached at all. */
function mintRefusal(refused: Refusal): Refusal {
  return refused === UNREACHABLE ? UNREACHABLE : REFUSED;
}

// --- exports ---

export class GitHubTracker implements Tracker {
  readonly #options: GitHubTrackerOptions;
  #key: Promise<CryptoKey> | null = null;

  constructor(options: GitHubTrackerOptions) {
    this.#options = options;
  }

  async openIssue(draft: TrackerIssueDraft): Promise<{ readonly number: number } | Refusal> {
    const body = { title: draft.title, body: draft.body, labels: draft.labels };
    const issue = await this.#issueCall(draft.repository, { method: 'POST', path: '/issues', body }, IssueShape);
    return isRefusal(issue) ? issue : { number: issue.number };
  }

  async closeIssue(close: TrackerIssueRef & { readonly reason: CloseReason }): Promise<TrackerState | Refusal> {
    const body = { state: 'closed', state_reason: close.reason };
    return this.#issueState(close.repository, { method: 'PATCH', path: `/issues/${close.number}`, body });
  }

  async reopenIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    return this.#issueState(issue.repository, { method: 'PATCH', path: `/issues/${issue.number}`, body: { state: 'open' } });
  }

  async postComment(comment: TrackerIssueRef & { readonly body: string }): Promise<{ readonly id: number } | Refusal> {
    const call = { method: 'POST', path: `/issues/${comment.number}/comments`, body: { body: comment.body } };
    const posted = await this.#issueCall(comment.repository, call, CommentShape);
    return isRefusal(posted) ? posted : { id: posted.id };
  }

  async getIssue(issue: TrackerIssueRef): Promise<TrackerState | Refusal> {
    return this.#issueState(issue.repository, { method: 'GET', path: `/issues/${issue.number}` });
  }

  // --- flow: issue calls ---

  async #issueState(repository: Repository, call: Call): Promise<TrackerState | Refusal> {
    const issue = await this.#issueCall(repository, call, IssueShape);
    return isRefusal(issue) ? issue : stateOf(issue);
  }

  async #issueCall<T>(repository: Repository, call: Call, shape: z.ZodType<T>): Promise<T | Refusal> {
    const parts = partsOf(repository);
    if (parts === null) return REFUSED;
    const token = await this.#installationToken(parts);
    if (isRefusal(token)) return token;
    const path = `/repos/${parts.owner}/${parts.name}${call.path}`;
    return this.#send({ ...call, path }, `Bearer ${token}`, shape);
  }

  // --- flow: installation tokens ---

  async #installationToken(parts: { owner: string; name: string }): Promise<string | Refusal> {
    const now = this.#options.clock.now();
    const cached = await this.#options.tokens.get(parts.owner);
    if (cached && cached.expiresAt - REFRESH_MARGIN > now) return cached.token;
    const jwt = `Bearer ${await this.#appJwt(now)}`;
    const installation = await this.#send(
      { method: 'GET', path: `/repos/${parts.owner}/${parts.name}/installation` },
      jwt,
      InstallationShape,
    );
    if (isRefusal(installation)) return mintRefusal(installation);
    const minted = await this.#send({ method: 'POST', path: `/app/installations/${installation.id}/access_tokens` }, jwt, TokenShape);
    if (isRefusal(minted)) return mintRefusal(minted);
    await this.#options.tokens.put(parts.owner, { token: minted.token, expiresAt: Date.parse(minted.expires_at) });
    return minted.token;
  }

  async #appJwt(now: number): Promise<string> {
    this.#key ??= importPKCS8(this.#options.privateKey, ALGORITHM);
    const issuedAt = Math.floor(now / 1000) - JWT_BACKDATE_SECONDS;
    return new SignJWT({})
      .setProtectedHeader({ alg: ALGORITHM })
      .setIssuer(this.#options.appId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + JWT_LIFETIME_SECONDS)
      .sign(await this.#key);
  }

  // --- action: one request ---

  async #send<T>(call: Call, authorization: string, shape: z.ZodType<T>): Promise<T | Refusal> {
    const init: RequestInit = { method: call.method, headers: { ...HEADERS, authorization } };
    if (call.body !== undefined) init.body = JSON.stringify(call.body);
    let response: Response;
    try {
      response = await this.#options.fetch(`${this.#options.apiBaseUrl ?? API}${call.path}`, init);
    } catch {
      return UNREACHABLE;
    }
    if (!response.ok) return refusalOf(response.status);
    const parsed = shape.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data : REFUSED;
  }
}
