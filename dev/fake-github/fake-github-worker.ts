/**
 * The local fake GitHub -- the stand-in for GitHub on the local stage
 * (architecture, Local development: issues, comments, webhooks signed with a
 * local secret). It serves the REST and GraphQL subset the github adapter
 * calls (issues create, update and comment; installation tokens; blame;
 * contents) through FakeGitHub, the same fake the adapter's unit tests use,
 * and a few control routes under `/__fake/` that act as a person on GitHub
 * would, each sending the matching webhook, signed with the webhook secret,
 * to the github Worker.
 *
 * The App's public key is derived from the App key the notifier holds, so
 * one secret serves both sides. State lives in this isolate for as long as
 * the dev session runs.
 */

import { exportJWK, importJWK, importPKCS8 } from 'jose';
import { FakeGitHub } from '../../tests/_fakes/fake-github.js';

export type FakeGitHubEnv = {
  readonly GITHUB_APP_ID: string;
  readonly GITHUB_APP_PRIVATE_KEY?: string;
  readonly GITHUB_WEBHOOK_SECRET?: string;
  /** The github Worker, where webhooks go. */
  readonly NIGHTWATCH_GITHUB?: Fetcher;
};

type Webhook = { readonly event: string; readonly payload: unknown };

const API_ORIGIN = 'https://api.github.com';
const CONTROL_PREFIX = '/__fake/';
const WEBHOOK_URL = 'https://nightwatch-github.local/webhooks/github';
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi'];

/** Which owner each App installation is on; registered through `/__fake/installations`. */
const installations: Record<string, number> = {};
let fake: Promise<FakeGitHub> | null = null;

// --- helpers ---

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function repositoryPayload(repository: string): { full_name: string; name: string; owner: { login: string } } {
  const [owner = '', name = ''] = repository.split('/');
  return { full_name: repository, name, owner: { login: owner } };
}

/** The `issues` webhook GitHub sends when a person closes or reopens an issue. */
export function issueStateWebhook(change: {
  repository: string;
  number: number;
  state: 'open' | 'closed';
  reason: string | null;
  actor: string;
}): Webhook {
  const action = change.state === 'closed' ? 'closed' : 'reopened';
  const stateReason = change.state === 'closed' ? (change.reason ?? 'completed') : 'reopened';
  return {
    event: 'issues',
    payload: {
      action,
      issue: { number: change.number, state: change.state, state_reason: stateReason },
      repository: repositoryPayload(change.repository),
      sender: { login: change.actor },
    },
  };
}

/** The `issue_comment` webhook GitHub sends when a person comments on an issue. */
export function commentWebhook(comment: { repository: string; number: number; body: string; actor: string; association: string }): Webhook {
  return {
    event: 'issue_comment',
    payload: {
      action: 'created',
      issue: { number: comment.number },
      comment: { body: comment.body, user: { login: comment.actor }, author_association: comment.association },
      repository: repositoryPayload(comment.repository),
      sender: { login: comment.actor },
    },
  };
}

// --- actions ---

async function publicKeyOf(privateKey: string): Promise<CryptoKey> {
  const jwk = await exportJWK(await importPKCS8(privateKey, 'RS256', { extractable: true }));
  const publicJwk = Object.fromEntries(Object.entries(jwk).filter(([field]) => !PRIVATE_JWK_FIELDS.includes(field)));
  return (await importJWK(publicJwk, 'RS256')) as CryptoKey;
}

async function createFake(env: FakeGitHubEnv): Promise<FakeGitHub> {
  if (env.GITHUB_APP_PRIVATE_KEY === undefined) throw new Error('fake GitHub needs GITHUB_APP_PRIVATE_KEY (.dev.vars)');
  const publicKey = await publicKeyOf(env.GITHUB_APP_PRIVATE_KEY);
  return new FakeGitHub({ appId: env.GITHUB_APP_ID, publicKey, clock: { now: () => Date.now() }, installations });
}

function fakeOf(env: FakeGitHubEnv): Promise<FakeGitHub> {
  fake ??= createFake(env).catch((error: unknown) => {
    fake = null;
    throw error;
  });
  return fake;
}

/** Signs the webhook with the shared secret, as GitHub does, and sends it to the github Worker. */
async function sendWebhook(webhook: Webhook, env: FakeGitHubEnv): Promise<number> {
  if (env.NIGHTWATCH_GITHUB === undefined || env.GITHUB_WEBHOOK_SECRET === undefined) throw new Error('fake GitHub cannot send webhooks');
  const body = JSON.stringify(webhook.payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const response = await env.NIGHTWATCH_GITHUB.fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': webhook.event,
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  });
  return response.status;
}

// --- control routes: a person on GitHub ---

async function control(route: string, body: Record<string, unknown>, env: FakeGitHubEnv): Promise<Response> {
  const repository = String(body['repository'] ?? '');
  const number = Number(body['number']);
  const actor = String(body['actor'] ?? 'octocat');
  switch (route) {
    case 'installations':
      installations[String(body['owner'])] = Number(body['id']);
      return json(201, { owner: body['owner'], id: body['id'] });
    case 'issues/close':
    case 'issues/reopen': {
      const state = route === 'issues/close' ? 'closed' : 'open';
      const reason = typeof body['reason'] === 'string' ? body['reason'] : null;
      if (!(await fakeOf(env)).setIssueState({ repository, number, state, reason })) return json(404, { message: 'Not Found' });
      return json(200, { webhook: await sendWebhook(issueStateWebhook({ repository, number, state, reason, actor }), env) });
    }
    case 'comments': {
      const association = String(body['association'] ?? 'MEMBER');
      return json(200, {
        webhook: await sendWebhook(commentWebhook({ repository, number, body: String(body['body'] ?? ''), actor, association }), env),
      });
    }
    case 'issue':
      return json(200, (await fakeOf(env)).issueState({ repository, number }));
    default:
      return json(404, { message: 'Not Found' });
  }
}

// --- entry ---

/** Serves one request: a control route, or the GitHub API subset under GitHub's own URLs. */
export async function fakeGitHubFetch(request: Request, env: FakeGitHubEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith(CONTROL_PREFIX)) {
    const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : Object.fromEntries(url.searchParams);
    return control(url.pathname.slice(CONTROL_PREFIX.length), body, env);
  }
  const api = new Request(`${API_ORIGIN}${url.pathname}${url.search}`, request);
  return (await fakeOf(env)).fetch(api);
}
