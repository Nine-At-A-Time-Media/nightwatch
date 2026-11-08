// The github Worker's webhook route in workerd, over local D1 and ProjectDO:
// a webhook is verified before it is parsed (401 otherwise), and a verified
// one is applied and answered 202. End to end with the local fake GitHub: an
// issue opened from Nightwatch, closed on the fake GitHub, comes back as a
// signed webhook that resolves the Nightwatch Issue.
import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1ControlStore } from '../../../src/adapters/d1/d1-control-store.js';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import { SystemClock } from '../../../src/adapters/runtime/system-clock.js';
import { openExternalIssue } from '../../../src/application/tracker/open-external-issue.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import { isRefusal } from '../../../src/domain/refusal.js';
import type { GitHubWorkerBindings } from '../../../src/workers/github/deps.js';
import { githubTracker, trackerSettings, type GitHubAppBindings } from '../../../src/workers/shared/github.js';
import { seedProject, seedRepository } from '../control-seed.js';

const WEBHOOK_URL = 'https://nightwatch-github.local/webhooks/github';
const FAKE = 'https://fake-github.local/__fake';

// --- harness ---

const bindings = () => env as unknown as GitHubWorkerBindings & GitHubAppBindings;
const projects = () => new DurableProjectClient({ namespace: bindings().PROJECT });

async function signature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function deliver(event: string, payload: unknown, secret: string = env.GITHUB_WEBHOOK_SECRET): Promise<Response> {
  const body = JSON.stringify(payload);
  return SELF.fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': await signature(body, secret) },
    body,
  });
}

async function fake(route: string, body: unknown): Promise<Response> {
  return bindings().GITHUB_API!.fetch(`${FAKE}/${route}`, { method: 'POST', body: JSON.stringify(body) });
}

function summary(eventId: string): EventSummary {
  return {
    eventId,
    at: Date.now(),
    release: null,
    environment: 'production',
    level: 'error',
    userKey: 'user-1',
    title: 'TypeError',
    culprit: null,
  };
}

async function openIssue(projectId: string): Promise<string> {
  const assignment = await projects().assignEvent(projectId, summary(crypto.randomUUID()), [`fp-${crypto.randomUUID()}`]);
  if (!('issueId' in assignment)) throw new Error('no issue opened');
  return assignment.issueId;
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

// --- the route ---

describe('POST /webhooks/github', () => {
  it('answers 401 to a webhook whose signature does not verify, and applies nothing', async () => {
    const seeded = await seedProject(env.CONTROL);
    const repository = `owner${crypto.randomUUID().slice(0, 8)}/shop`;
    await seedRepository(env.CONTROL, seeded.organizationId, repository);
    const issueId = await openIssue(seeded.projectId);
    await new D1ControlStore(env.CONTROL).putLinkEntry({ repository, number: 7, projectId: seeded.projectId, issueId });
    const payload = {
      action: 'closed',
      issue: { number: 7, state_reason: 'completed' },
      repository: { full_name: repository },
      sender: { login: 'octocat' },
    };

    const forged = await deliver('issues', payload, 'not-the-secret');
    const unsigned = await SELF.fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'x-github-event': 'issues' },
      body: JSON.stringify(payload),
    });

    expect(forged.status).toBe(401);
    expect(unsigned.status).toBe(401);
    expect((await projects().getIssue(seeded.projectId, issueId))?.status).toBe('unresolved');
  });

  it('answers 401 before parsing a body that is not even JSON', async () => {
    const response = await SELF.fetch(WEBHOOK_URL, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: '{not json' });
    expect(response.status).toBe(401);
  });

  it('answers 202 to a verified webhook Nightwatch does not act on', async () => {
    const response = await deliver('ping', { zen: 'Keep it logically awesome.' });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ trackerEvents: 0, commits: 0 });
  });

  it('refuses any route but the webhook', async () => {
    expect((await SELF.fetch('https://nightwatch-github.local/other', { method: 'POST' })).status).toBe(404);
    expect((await SELF.fetch(WEBHOOK_URL)).status).toBe(405);
  });
});

// --- end to end with the fake GitHub ---

describe('github Worker with the local fake GitHub', () => {
  it('GitHub close resolves -- Given an issue opened from Nightwatch, When it is closed on GitHub, Then the webhook resolves the Nightwatch Issue', async () => {
    const seeded = await seedProject(env.CONTROL);
    const owner = `acme${crypto.randomUUID().slice(0, 8)}`;
    const repository = `${owner}/shop`;
    await seedRepository(env.CONTROL, seeded.organizationId, repository);
    await fake('installations', { owner, id: Math.floor(Math.random() * 1e9) });
    const issueId = await openIssue(seeded.projectId);
    const clock = new SystemClock();
    const linked = await openExternalIssue(
      seeded.projectId,
      issueId,
      repository,
      { member: seeded.member },
      {
        tracker: githubTracker(bindings(), clock),
        projects: projects(),
        control: new D1ControlStore(env.CONTROL),
        settings: trackerSettings(bindings()),
      },
    );
    if (isRefusal(linked)) throw new Error(`could not open the GitHub issue: ${linked.refusal}`);

    const closed = await fake('issues/close', { repository, number: linked.number, reason: 'completed', actor: 'octocat' });

    expect(await closed.json()).toEqual({ webhook: 202 });
    const issue = await projects().getIssue(seeded.projectId, issueId);
    expect(issue?.status).toBe('resolved');
    expect(await projects().externalLinkOf(seeded.projectId, issueId)).toMatchObject({
      lastKnown: { state: 'closed', reason: 'completed' },
    });
  });
});
