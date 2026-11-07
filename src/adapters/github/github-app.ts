/**
 * GitHubApp -- calls to GitHub's API as a GitHub App's installation on a
 * Repository's owner, shared by the Tracker and CodeHost adapters
 * (architecture Mechanism, Code and GitHub).
 *
 * An installation token is minted with a short-lived App JWT (RS256, signed
 * with the App key from settings, PKCS#8 PEM), and kept in the TokenCache
 * until shortly before it expires. `fetch` and the clock are injected, so
 * tests reach no network. Every failure becomes one of the caller's three
 * Refusals: not found (404), refused (any other refusal, or a token that
 * cannot be minted), or unreachable (a request that cannot be made).
 */

import { importPKCS8, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';
import { isRefusal, type Refusal } from '../../domain/refusal.js';
import type { Repository } from '../../domain/tracker/external-link.js';
import type { Clock } from '../../ports/clock.js';
import type { TokenCache } from './token-cache.js';

export type GitHubAppOptions = {
  readonly appId: string;
  /** The App's private key as a PKCS#8 PEM. */
  readonly privateKey: string;
  readonly fetch: typeof fetch;
  readonly tokens: TokenCache;
  readonly clock: Clock;
  /** The REST API origin; GitHub's public API unless set. */
  readonly apiBaseUrl?: string;
};

/** The Refusals one adapter answers with. */
export type GitHubRefusals = { readonly notFound: Refusal; readonly refused: Refusal; readonly unreachable: Refusal };

/** One API request; `path` is relative to the API origin. */
export type GitHubCall = { readonly method: string; readonly path: string; readonly body?: unknown };

export type RepositoryParts = { readonly owner: string; readonly name: string };

const API = 'https://api.github.com';
const ALGORITHM = 'RS256';
/** A token this close to expiry is minted afresh. */
const REFRESH_MARGIN = 5 * 60_000;
/** The App JWT is backdated against clock skew and lives under GitHub's ten-minute limit. */
const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const REPOSITORY_NAME = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'nightwatch' };

const InstallationShape = z.object({ id: z.number().int() });
const TokenShape = z.object({ token: z.string(), expires_at: z.string() });

// --- helpers ---

/** The owner and name of a Repository, or null when it is not `owner/name`. */
function partsOf(repository: Repository): RepositoryParts | null {
  const match = REPOSITORY_NAME.exec(repository);
  if (!match?.[1] || !match[2] || match[1] === '..' || match[2] === '..') return null;
  return { owner: match[1], name: match[2] };
}

// --- exports ---

export class GitHubApp {
  readonly #options: GitHubAppOptions;
  readonly #refusals: GitHubRefusals;
  #key: Promise<CryptoKey> | null = null;

  constructor(options: GitHubAppOptions, refusals: GitHubRefusals) {
    this.#options = options;
    this.#refusals = refusals;
  }

  /** Makes the call `build` names for the Repository, as the App's installation on its owner. */
  async asInstallation<T>(
    repository: Repository,
    build: (parts: RepositoryParts) => GitHubCall,
    shape: z.ZodType<T>,
  ): Promise<T | Refusal> {
    const parts = partsOf(repository);
    if (parts === null) return this.#refusals.refused;
    const token = await this.#installationToken(parts);
    if (isRefusal(token)) return token;
    return this.#send(build(parts), `Bearer ${token}`, shape);
  }

  // --- flow: installation tokens ---

  async #installationToken(parts: RepositoryParts): Promise<string | Refusal> {
    const now = this.#options.clock.now();
    const cached = await this.#options.tokens.get(parts.owner);
    if (cached && cached.expiresAt - REFRESH_MARGIN > now) return cached.token;
    const jwt = `Bearer ${await this.#appJwt(now)}`;
    const installation = await this.#send(
      { method: 'GET', path: `/repos/${parts.owner}/${parts.name}/installation` },
      jwt,
      InstallationShape,
    );
    if (isRefusal(installation)) return this.#mintRefusal(installation);
    const minted = await this.#send({ method: 'POST', path: `/app/installations/${installation.id}/access_tokens` }, jwt, TokenShape);
    if (isRefusal(minted)) return this.#mintRefusal(minted);
    await this.#options.tokens.put(parts.owner, { token: minted.token, expiresAt: Date.parse(minted.expires_at) });
    return minted.token;
  }

  /** A token that cannot be minted refuses the call, unless GitHub could not be reached at all. */
  #mintRefusal(refused: Refusal): Refusal {
    return refused === this.#refusals.unreachable ? this.#refusals.unreachable : this.#refusals.refused;
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

  async #send<T>(call: GitHubCall, authorization: string, shape: z.ZodType<T>): Promise<T | Refusal> {
    const init: RequestInit = { method: call.method, headers: { ...HEADERS, authorization } };
    if (call.body !== undefined) init.body = JSON.stringify(call.body);
    let response: Response;
    try {
      response = await this.#options.fetch(`${this.#options.apiBaseUrl ?? API}${call.path}`, init);
    } catch {
      return this.#refusals.unreachable;
    }
    if (!response.ok) return response.status === 404 ? this.#refusals.notFound : this.#refusals.refused;
    const parsed = shape.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data : this.#refusals.refused;
  }
}
