/**
 * FakeGitHub -- an in-memory stand-in for the slice of the GitHub REST API
 * the github adapter calls, served through a `fetch` function so the
 * adapter's tests reach no network. It checks the App JWT against the App's
 * public key, mints installation tokens that expire after an hour on the
 * injected clock, checks each issue call's token belongs to the Repository
 * owner's installation, and keeps issues and comments per Repository.
 * Files put with `putFile` are served by the contents API and blamed by the
 * GraphQL endpoint, with the same installation-token check.
 * Every request is recorded for request-shape assertions. `refusing` makes
 * every issue call answer with that HTTP status.
 */

import { jwtVerify } from 'jose';
import type { HostedFile } from './fake-code-host.js';

export type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly accept: string | null;
  readonly body: unknown;
};

type Issue = { state: 'open' | 'closed'; state_reason: string | null; comments: number };

const HOUR = 3_600_000;
const INSTALLATION = /^\/repos\/([^/]+)\/([^/]+)\/installation$/;
const ACCESS_TOKENS = /^\/app\/installations\/(\d+)\/access_tokens$/;
const ISSUES = /^\/repos\/([^/]+)\/([^/]+)\/issues$/;
const ISSUE = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;
const COMMENTS = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/;
const CONTENTS = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export class FakeGitHub {
  readonly requests: RecordedRequest[] = [];
  refusing: number | null = null;
  readonly #appId: string;
  readonly #publicKey: CryptoKey;
  readonly #clock: { now(): number };
  readonly #installations: Readonly<Record<string, number>>;
  readonly #tokens = new Map<string, { installation: number; expiresAt: number }>();
  readonly #issues = new Map<string, Issue[]>();
  readonly #files = new Map<string, HostedFile>();
  #minted = 0;

  /** `installations` maps a Repository owner to the id of the App's installation on it. */
  constructor(options: { appId: string; publicKey: CryptoKey; clock: { now(): number }; installations: Readonly<Record<string, number>> }) {
    this.#appId = options.appId;
    this.#publicKey = options.publicKey;
    this.#clock = options.clock;
    this.#installations = options.installations;
  }

  /** How many installation tokens were minted. */
  get minted(): number {
    return this.#minted;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    this.requests.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get('authorization'),
      accept: request.headers.get('accept'),
      body,
    });
    if (url.origin !== 'https://api.github.com') return json(404, { message: 'Not Found' });
    const authorization = request.headers.get('authorization') ?? '';
    if (url.pathname === '/graphql' && request.method === 'POST') return this.#graphql(authorization, body);
    const contents = CONTENTS.exec(url.pathname);
    if (contents && request.method === 'GET')
      return this.#contents(authorization, { match: contents, ref: url.searchParams.get('ref') ?? '' });
    return this.#route(request.method, url.pathname, authorization, body);
  };

  /** Puts a file, with its text and blame ranges, in a Repository at a ref. */
  putFile(file: HostedFile): void {
    this.#files.set(`${file.repository}@${file.ref}:${file.path}`, file);
  }

  #contents(authorization: string, request: { match: RegExpExecArray; ref: string }): Response {
    const [, owner = '', name = '', path = ''] = request.match;
    if (!this.#tokenAllows(authorization, owner)) return json(401, { message: 'Bad credentials' });
    if (this.refusing !== null) return json(this.refusing, { message: 'Refused' });
    const file = this.#files.get(`${owner}/${name}@${request.ref}:${decodeURIComponent(path)}`);
    if (!file) return json(404, { message: 'Not Found' });
    const content = Buffer.from(file.text, 'utf8').toString('base64');
    return json(200, { type: 'file', encoding: 'base64', content: content.replace(/.{60}/g, '$&\n') });
  }

  #graphql(authorization: string, body: unknown): Response {
    const variables = (typeof body === 'object' && body !== null && 'variables' in body ? body.variables : {}) as Record<string, string>;
    const { owner = '', name = '', ref = '', path = '' } = variables;
    if (!this.#tokenAllows(authorization, owner)) return json(401, { message: 'Bad credentials' });
    if (this.refusing !== null) return json(this.refusing, { message: 'Refused' });
    const hasRef = [...this.#files.values()].some((file) => file.repository === `${owner}/${name}` && file.ref === ref);
    if (!hasRef) return json(200, { data: { repository: { object: null } } });
    const file = this.#files.get(`${owner}/${name}@${ref}:${path}`);
    if (!file)
      return json(200, { data: { repository: { object: { blame: null } } }, errors: [{ type: 'NOT_FOUND', message: 'no such path' }] });
    const ranges = file.blame.map((range) => ({
      startingLine: range.startingLine,
      endingLine: range.endingLine,
      commit: {
        oid: range.commit.hash,
        committedDate: new Date(range.commit.at).toISOString(),
        author: {
          email: range.commit.author.email ?? '',
          user: range.commit.author.login === null ? null : { login: range.commit.author.login },
        },
      },
    }));
    return json(200, { data: { repository: { object: { blame: { ranges } } } } });
  }

  async #route(method: string, path: string, authorization: string, body: unknown): Promise<Response> {
    const installation = INSTALLATION.exec(path);
    if (method === 'GET' && installation) return this.#installation(authorization, installation[1] ?? '');
    const tokens = ACCESS_TOKENS.exec(path);
    if (method === 'POST' && tokens) return this.#mint(authorization, Number(tokens[1]));
    const match = COMMENTS.exec(path) ?? ISSUE.exec(path) ?? ISSUES.exec(path);
    if (!match) return json(404, { message: 'Not Found' });
    const [, owner = '', name = '', number] = match;
    if (!this.#tokenAllows(authorization, owner)) return json(401, { message: 'Bad credentials' });
    if (this.refusing !== null) return json(this.refusing, { message: 'Refused' });
    return this.#issueCall({ method, path, repository: `${owner}/${name}`, number: number === undefined ? null : Number(number), body });
  }

  async #isAppJwt(authorization: string): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(authorization.replace(/^Bearer /, ''), this.#publicKey, {
        issuer: this.#appId,
        algorithms: ['RS256'],
        currentDate: new Date(this.#clock.now()),
      });
      return typeof payload.exp === 'number' && typeof payload.iat === 'number' && payload.exp - payload.iat <= 600;
    } catch {
      return false;
    }
  }

  async #installation(authorization: string, owner: string): Promise<Response> {
    if (!(await this.#isAppJwt(authorization))) return json(401, { message: 'Bad credentials' });
    const id = this.#installations[owner];
    return id === undefined ? json(404, { message: 'Not Found' }) : json(200, { id });
  }

  async #mint(authorization: string, installation: number): Promise<Response> {
    if (!(await this.#isAppJwt(authorization))) return json(401, { message: 'Bad credentials' });
    if (!Object.values(this.#installations).includes(installation)) return json(404, { message: 'Not Found' });
    this.#minted += 1;
    const token = `ghs_fake${this.#minted}`;
    const expiresAt = this.#clock.now() + HOUR;
    this.#tokens.set(token, { installation, expiresAt });
    return json(201, { token, expires_at: new Date(expiresAt).toISOString() });
  }

  #tokenAllows(authorization: string, owner: string): boolean {
    const held = this.#tokens.get(authorization.replace(/^(Bearer|token) /, ''));
    return held !== undefined && held.expiresAt > this.#clock.now() && this.#installations[owner] === held.installation;
  }

  #issueCall(call: { method: string; path: string; repository: string; number: number | null; body: unknown }): Response {
    const issues = this.#issues.get(call.repository) ?? [];
    this.#issues.set(call.repository, issues);
    if (call.number === null) {
      if (call.method !== 'POST') return json(404, { message: 'Not Found' });
      issues.push({ state: 'open', state_reason: null, comments: 0 });
      return json(201, { number: issues.length, state: 'open', state_reason: null });
    }
    const issue = issues[call.number - 1];
    if (!issue) return json(404, { message: 'Not Found' });
    if (call.path.endsWith('/comments')) {
      if (call.method !== 'POST') return json(404, { message: 'Not Found' });
      issue.comments += 1;
      return json(201, { id: call.number * 1000 + issue.comments });
    }
    if (call.method === 'PATCH') this.#patch(issue, call.body);
    return json(200, { number: call.number, state: issue.state, state_reason: issue.state_reason });
  }

  #patch(issue: Issue, body: unknown): void {
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (fields['state'] === 'closed') {
      issue.state = 'closed';
      issue.state_reason = typeof fields['state_reason'] === 'string' ? fields['state_reason'] : 'completed';
    } else if (fields['state'] === 'open') {
      issue.state = 'open';
      issue.state_reason = 'reopened';
    }
  }

  // --- task-033: a person acting on GitHub, for the local fake GitHub Worker ---

  /** The issue's state and close reason, or null when the Repository has no such issue. */
  issueState(issue: { repository: string; number: number }): { state: 'open' | 'closed'; stateReason: string | null } | null {
    const held = this.#issues.get(issue.repository)?.[issue.number - 1];
    return held ? { state: held.state, stateReason: held.state_reason } : null;
  }

  /** Closes or reopens the issue as a person on GitHub would; false when there is no such issue. */
  setIssueState(change: { repository: string; number: number; state: 'open' | 'closed'; reason: string | null }): boolean {
    const held = this.#issues.get(change.repository)?.[change.number - 1];
    if (!held) return false;
    this.#patch(held, { state: change.state, state_reason: change.reason });
    return true;
  }
}
