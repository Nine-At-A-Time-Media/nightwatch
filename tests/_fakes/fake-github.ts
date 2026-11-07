/**
 * FakeGitHub -- an in-memory stand-in for the slice of the GitHub REST API
 * the github adapter calls, served through a `fetch` function so the
 * adapter's tests reach no network. It checks the App JWT against the App's
 * public key, mints installation tokens that expire after an hour on the
 * injected clock, checks each issue call's token belongs to the Repository
 * owner's installation, and keeps issues and comments per Repository.
 * Every request is recorded for request-shape assertions. `refusing` makes
 * every issue call answer with that HTTP status.
 */

import { jwtVerify } from 'jose';

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
    return this.#route(request.method, url.pathname, request.headers.get('authorization') ?? '', body);
  };

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
}
