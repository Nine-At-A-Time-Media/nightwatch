// The notifier Worker's queue consumer in workerd, over local D1, R2, KV,
// DigestDO and ProjectDO bindings: an Issue Change fans out into one step
// message per piece of work; each step message is acknowledged or retried on
// its own; issue alerts gather into DigestDO, whose alarm sends the Digest;
// a change made in Nightwatch closes the linked issue on the local fake
// GitHub. Also the KV TokenCache against the in-memory one.
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import { digestObjectName, DurableDigestQueue } from '../../../src/adapters/do/durable-digest-queue.js';
import type { InstallationToken } from '../../../src/adapters/github/token-cache.js';
import { MemoryTokenCache, type TokenCache } from '../../../src/adapters/github/token-cache.js';
import { KvTokenCache } from '../../../src/adapters/kv/kv-token-cache.js';
import type { EffectMessage } from '../../../src/adapters/queues/queue-effect-queue.js';
import { SystemClock } from '../../../src/adapters/runtime/system-clock.js';
import type { Digest } from '../../../src/domain/alerts/digest.js';
import type { IssueAlertRule } from '../../../src/domain/alerts/issue-alert-rule.js';
import type { EventSummary } from '../../../src/domain/event/event-summary.js';
import type { IssueChange } from '../../../src/domain/issue/state.js';
import { isRefusal } from '../../../src/domain/refusal.js';
import { link } from '../../../src/domain/tracker/external-link.js';
import type { NotifierBindings } from '../../../src/workers/notifier/deps.js';
import worker from '../../../src/workers/notifier/index.js';
import { githubTracker } from '../../../src/workers/shared/github.js';
import type { NormalizedEvent } from '../../../src/domain/normalize/normalized-event.js';
import { encodeScrubbedEvent } from '../../../src/domain/processing/processing.js';
import { eventBlobKey } from '../../../src/domain/event/event-summary.js';
import { seedAlertRule, seedOwnershipConfig, seedProject, seedRepository } from '../control-seed.js';

const MINUTE = 60_000;

// --- harness ---

/** The Worker's environment, optionally with a recording EFFECTS producer in place of the queue. */
function notifierEnv(overrides: Partial<NotifierBindings> = {}): NotifierBindings {
  return { ...(env as unknown as NotifierBindings), ...overrides };
}

/** A Queue producer that keeps every body sent. */
function recordingQueue(): { queue: Queue; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const queue = {
    send: async (body: unknown) => {
      bodies.push(body);
    },
    sendBatch: async (messages: Iterable<MessageSendRequest>) => {
      for (const message of messages) bodies.push(message.body);
    },
  } as unknown as Queue;
  return { queue, bodies };
}

/** Hands the consumer one batch and reports which messages it acknowledged and which it retried. */
async function consume(bodies: readonly unknown[], bindings: NotifierBindings = notifierEnv()) {
  const batch = createMessageBatch(
    'nightwatch-effects',
    bodies.map((body, index) => ({ id: `message-${index}`, timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, bindings);
  const result = await getQueueResult(batch, ctx);
  return { acked: result.explicitAcks, retried: result.retryMessages.map((message) => message.msgId) };
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

const projects = () => new DurableProjectClient({ namespace: notifierEnv().PROJECT });

/** Opens a new Issue in the Project; returns it and the change that opened it. */
async function openIssue(projectId: string): Promise<{ issueId: string; opened: IssueChange }> {
  const assignment = await projects().assignEvent(projectId, summary(crypto.randomUUID()), [`fp-${crypto.randomUUID()}`]);
  const opened = assignment.changes.find((change) => change.kind === 'status' && change.from === null);
  if (!('issueId' in assignment) || opened === undefined) throw new Error('no new issue opened');
  return { issueId: assignment.issueId, opened };
}

function firstSeenRule(member: string): IssueAlertRule {
  return {
    ruleId: `rule-${crypto.randomUUID()}`,
    triggers: [{ kind: 'first_seen' }],
    actionMatch: 'any',
    filters: [],
    filterMatch: 'all',
    actions: [{ kind: 'email', to: { kind: 'member', member } }],
    quietPeriodMs: MINUTE,
  };
}

async function heldDigest(name: string): Promise<Digest | undefined> {
  return runInDurableObject(notifierEnv().DIGEST.getByName(name) as unknown as DurableObjectStub, (_instance, state) =>
    state.storage.get<Digest>('digest'),
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

// --- the consumer ---

describe('notifier queue consumer', () => {
  it('fans an Issue Change out into one step message per piece of work, and acknowledges it', async () => {
    const { projectId } = await seedProject(env.CONTROL);
    const { opened } = await openIssue(projectId);
    const sink = recordingQueue();

    const result = await consume([{ projectId, change: opened }], notifierEnv({ EFFECTS: sink.queue }));

    expect(result).toEqual({ acked: ['message-0'], retried: [] });
    expect((sink.bodies as EffectMessage[]).map((body) => [body.projectId, body.change, body.step])).toEqual(
      ['notifyReporters', 'notifyFollowers', 'evaluateIssueAlerts', 'pushIssueChange', 'suggestOwners'].map((step) => [
        projectId,
        opened,
        step,
      ]),
    );
  });

  it('acknowledges each step message on its own and retries only the one that fails', async () => {
    const { projectId } = await seedProject(env.CONTROL);
    const { opened } = await openIssue(projectId);

    const result = await consume([
      { projectId, change: opened, step: 'notifyFollowers' },
      { projectId, change: opened, step: 'sendFax' },
      { not: 'an effect message' },
      { projectId, change: opened, step: 'notifyReporters' },
    ]);

    expect(result).toEqual({ acked: ['message-0', 'message-3'], retried: ['message-1', 'message-2'] });
  });

  it('New issue alert -- Given a rule on new Issues, When an Issue opens, Then it fires and its email gathers into the Digest', async () => {
    const seeded = await seedProject(env.CONTROL);
    const rule = firstSeenRule(seeded.member);
    await seedAlertRule(env.CONTROL, seeded.projectId, rule);
    const { issueId, opened } = await openIssue(seeded.projectId);

    const result = await consume([{ projectId: seeded.projectId, change: opened, step: 'evaluateIssueAlerts' }]);

    expect(result.acked).toEqual(['message-0']);
    const [firing] = await projects().firingsOf(seeded.projectId, rule.ruleId);
    expect(firing).toMatchObject({ ruleId: rule.ruleId, issueId });
    expect(firing?.deliveries.map((delivery) => delivery.status)).toEqual(['pending']);
    const digest = await heldDigest(digestObjectName({ ruleId: rule.ruleId, recipient: seeded.email }));
    expect(digest?.items.map((item) => item.issueId)).toEqual([issueId]);
  });

  it("Nightwatch resolve closes GitHub -- Given an Issue linked to a GitHub issue, When it is resolved in Nightwatch, Then the fake GitHub's issue closes", async () => {
    const seeded = await seedProject(env.CONTROL);
    const owner = `acme${crypto.randomUUID().slice(0, 8)}`;
    const repository = `${owner}/shop`;
    await seedRepository(env.CONTROL, seeded.organizationId, repository);
    await env.GITHUB_API.fetch('https://fake-github.local/__fake/installations', {
      method: 'POST',
      body: JSON.stringify({ owner, id: Math.floor(Math.random() * 1e9) }),
    });
    const opened = await githubTracker(notifierEnv(), new SystemClock()).openIssue({
      repository,
      title: 'TypeError',
      body: 'evidence',
      labels: [],
    });
    if (isRefusal(opened)) throw new Error(`fake GitHub refused: ${opened.refusal}`);
    const { issueId } = await openIssue(seeded.projectId);
    await projects().recordExternalLink(
      seeded.projectId,
      link({ issueId, repository, number: opened.number, lastKnown: { state: 'open' } }),
    );
    const resolved: IssueChange = {
      issueId,
      kind: 'status',
      from: 'unresolved/new',
      to: 'resolved',
      actor: { member: seeded.member },
      origin: 'nightwatch',
      at: Date.now(),
    };

    const result = await consume([{ projectId: seeded.projectId, change: resolved, step: 'pushIssueChange' }]);

    expect(result.acked).toEqual(['message-0']);
    const state = await env.GITHUB_API.fetch(`https://fake-github.local/__fake/issue?repository=${repository}&number=${opened.number}`);
    expect(await state.json()).toEqual({ state: 'closed', stateReason: 'completed' });
    expect(await projects().externalLinkOf(seeded.projectId, issueId)).toMatchObject({ state: 'linked', expected: { state: 'closed' } });
  });

  it("Owner suggested -- Given an Ownership Rule matching the new Issue's stored Event, When the Issue opens, Then the matched Member is suggested and auto-assigned", async () => {
    const seeded = await seedProject(env.CONTROL);
    await seedOwnershipConfig(env.CONTROL, seeded.projectId, {
      ownershipRules: `path:src/pay/* ${seeded.email}`,
      codeMappings: [],
      autoAssign: true,
    });
    const eventId = crypto.randomUUID().replaceAll('-', '');
    const stored = {
      exceptions: [{ type: 'TypeError', value: null, frames: [{ filename: 'src/pay/charge.ts', lineno: 7, inApp: true }] }],
      stacktrace: null,
      request: null,
      tags: {},
    } as unknown as NormalizedEvent;
    await notifierEnv().BLOBS.put(
      eventBlobKey({ projectId: seeded.projectId, eventId }),
      encodeScrubbedEvent({ event: stored, removals: [] }),
    );
    const assignment = await projects().assignEvent(seeded.projectId, summary(eventId), [`fp-${crypto.randomUUID()}`]);
    const opened = assignment.changes.find((change) => change.kind === 'status' && change.from === null);
    if (!('issueId' in assignment) || opened === undefined) throw new Error('no new issue opened');

    const result = await consume([{ projectId: seeded.projectId, change: opened, step: 'suggestOwners' }]);

    expect(result.acked).toEqual(['message-0']);
    expect(await projects().assigneeOf(seeded.projectId, assignment.issueId)).toEqual({ member: seeded.member });
  });
});

// --- DigestDO ---

describe('DigestDO', () => {
  it('Digest gathers -- Given several alerts for one recipient and rule in a burst, When the Digest is due, Then one email sends them all', async () => {
    const key = { ruleId: `rule-${crypto.randomUUID()}`, recipient: 'ada@example.test' };
    const digests = new DurableDigestQueue({ namespace: notifierEnv().DIGEST });
    const past = Date.now() - 2 * 60 * MINUTE;
    await digests.add(key, { issueId: 'issue-1', title: 'TypeError', at: past });
    const due = await digests.add(key, { issueId: 'issue-2', title: 'RangeError', at: past + MINUTE });

    expect(due).toBeLessThan(Date.now());
    expect((await heldDigest(digestObjectName(key)))?.items).toHaveLength(2);

    const stub = notifierEnv().DIGEST.getByName(digestObjectName(key)) as unknown as DurableObjectStub;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await heldDigest(digestObjectName(key))).toBeUndefined();
    expect(await digests.take(key)).toEqual({ ...key, items: [] });
  });

  it('keeps a Digest that is not yet due, with its alarm at the due time', async () => {
    const key = { ruleId: `rule-${crypto.randomUUID()}`, recipient: 'ada@example.test' };
    const digests = new DurableDigestQueue({ namespace: notifierEnv().DIGEST });
    const due = await digests.add(key, { issueId: 'issue-1', title: 'TypeError', at: Date.now() });
    const stub = notifierEnv().DIGEST.getByName(digestObjectName(key)) as unknown as DurableObjectStub;

    expect(await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm())).toBe(due);
    await runDurableObjectAlarm(stub);
    expect((await heldDigest(digestObjectName(key)))?.items).toHaveLength(1);
    expect(await digests.take(key)).toMatchObject({ items: [{ issueId: 'issue-1' }] });
    expect(await heldDigest(digestObjectName(key))).toBeUndefined();
  });
});

// --- TokenCache ---

describe.each<{ name: string; make: () => TokenCache }>([
  { name: 'MemoryTokenCache', make: () => new MemoryTokenCache() },
  { name: 'KvTokenCache', make: () => new KvTokenCache({ kv: notifierEnv().GITHUB_TOKENS, now: () => Date.now() }) },
])('TokenCache contract -- $name', ({ make }) => {
  it('gives back the token put under a key, and nothing under another', async () => {
    const cache = make();
    const key = `owner-${crypto.randomUUID()}`;
    const token: InstallationToken = { token: 'ghs_abc', expiresAt: Date.now() + 60 * MINUTE };
    expect(await cache.get(key)).toBeNull();
    await cache.put(key, token);
    expect(await cache.get(key)).toEqual(token);
    expect(await cache.get(`${key}-other`)).toBeNull();
  });

  it('replaces the token under a key', async () => {
    const cache = make();
    const key = `owner-${crypto.randomUUID()}`;
    await cache.put(key, { token: 'ghs_old', expiresAt: Date.now() + MINUTE });
    await cache.put(key, { token: 'ghs_new', expiresAt: Date.now() + 60 * MINUTE });
    expect((await cache.get(key))?.token).toBe('ghs_new');
  });
});
