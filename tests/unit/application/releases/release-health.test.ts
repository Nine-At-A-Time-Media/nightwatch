import { describe, expect, it } from 'vitest';
import { releaseHealth } from '../../../../src/application/releases/release-health.js';
import type { Session } from '../../../../src/domain/release/health.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { DAY, MINUTE, policies, T0 } from '../../domain/issue/fixtures.js';

const PROJECT = 'project-1';

function projects(): FakeProjectClient {
  return new FakeProjectClient({
    clock: new FakeClock(T0),
    ids: new FakeIds(),
    effects: new FakeEffectQueue(),
    policies,
    dedupWindow: DAY,
  });
}

function session(status: Session['status'], userKey: string | null, overrides: Partial<Session> = {}): Session {
  return { release: 'web@1.0.0', environment: 'production', status, userKey, startedAt: T0, ...overrides };
}

describe('releaseHealth', () => {
  it('Crash-free rate: Given sessions for a release, When a member opens the release, Then crash-free session and user rates are shown', async () => {
    const client = projects();
    const sessions = [
      session('ok', 'ada'),
      session('crashed', 'ada', { startedAt: T0 + MINUTE }),
      session('exited', 'bob', { startedAt: T0 + 2 * MINUTE }),
      session('errored', null),
      session('abnormal', 'cat'),
      session('crashed', 'dan', { release: 'web@2.0.0' }),
      session('crashed', 'eve', { environment: 'staging' }),
    ];
    for (const s of sessions) await client.recordSession(PROJECT, s);

    expect(await releaseHealth(PROJECT, 'web@1.0.0', 'production', { projects: client })).toEqual({
      release: 'web@1.0.0',
      environment: 'production',
      sessions: 5,
      crashFreeSessionRate: 0.6,
      users: 3,
      crashFreeUserRate: 1 / 3,
    });
  });

  it('shows no rate for a release with no sessions', async () => {
    expect(await releaseHealth(PROJECT, 'web@9.9.9', 'production', { projects: projects() })).toMatchObject({
      sessions: 0,
      crashFreeSessionRate: null,
      users: 0,
      crashFreeUserRate: null,
    });
  });

  it("counts sessions only in the Project's own state", async () => {
    const client = projects();
    await client.recordSession('project-2', session('crashed', 'ada'));
    expect(await releaseHealth(PROJECT, 'web@1.0.0', 'production', { projects: client })).toMatchObject({ sessions: 0, users: 0 });
  });

  it('keeps per-minute counters by status', async () => {
    const client = projects();
    await client.recordSession(PROJECT, session('ok', 'ada', { startedAt: T0 + 10 }));
    await client.recordSession(PROJECT, session('ok', 'bob', { startedAt: T0 + 20 }));
    await client.recordSession(PROJECT, session('ok', 'ada', { startedAt: T0 + MINUTE }));
    expect(client.store(PROJECT).sessionBuckets()).toEqual([
      { release: 'web@1.0.0', environment: 'production', status: 'ok', minute: T0, sessions: 2 },
      { release: 'web@1.0.0', environment: 'production', status: 'ok', minute: T0 + MINUTE, sessions: 1 },
    ]);
  });
});
