// The scheduler's run with fakes: retention in every Organization's
// Projects, one failing Project not stopping the rest, and the usage
// comparison alerting the operator.
import { describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '../../../../src/domain/ids.js';
import type { Expiry, RetentionPolicy } from '../../../../src/domain/retention/retention.js';
import { runScheduled } from '../../../../src/workers/scheduler/scheduler-steps.js';
import { FakeEffectQueue } from '../../../_fakes/effect-queue.js';
import { FakeChannel } from '../../../_fakes/fake-channel.js';
import { FakeClock } from '../../../_fakes/fake-clock.js';
import { FakeControlStore } from '../../../_fakes/fake-control-store.js';
import { FakeIds } from '../../../_fakes/fake-ids.js';
import { FakeProjectClient } from '../../../_fakes/fake-project-client.js';
import { FakeUsageSource } from '../../../_fakes/fake-usage-source.js';
import { policies } from '../../domain/issue/fixtures.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7);
const RETENTION: RetentionPolicy = { raw: DAY, event: 90 * DAY, attachment: DAY, report: 365 * DAY, outcome: DAY, history: DAY };

/** A FakeProjectClient whose retention fails for the named Projects. */
class FailingProjects extends FakeProjectClient {
  readonly failing: ReadonlySet<ProjectId>;

  constructor(failing: readonly ProjectId[], clock: FakeClock) {
    super({ clock, ids: new FakeIds('issue'), effects: new FakeEffectQueue(), policies, dedupWindow: DAY });
    this.failing = new Set(failing);
  }

  override async enforceRetention(projectId: ProjectId, retention: RetentionPolicy): Promise<Expiry> {
    if (this.failing.has(projectId)) throw new Error('object unreachable');
    return super.enforceRetention(projectId, retention);
  }
}

function world({ failing = [] as ProjectId[], used = 0 } = {}) {
  const clock = new FakeClock(NOW);
  const control = new FakeControlStore();
  control.addProject('org-1', 'project-a');
  control.addProject('org-1', 'project-b');
  control.addProject('org-2', 'project-c');
  const webhook = new FakeChannel('webhook');
  const runtime = {
    control,
    projects: new FailingProjects(failing, clock),
    usage: new FakeUsageSource([{ product: 'workers_requests', used }]),
    channels: [webhook],
    clock,
    retention: RETENTION,
    limits: new Map([['workers_requests', 100]]),
    operator: [{ kind: 'webhook', url: 'https://ops.example/hook' }] as const,
  };
  return { runtime, webhook };
}

describe('runScheduled', () => {
  it("runs retention in every Organization's Projects", async () => {
    const { runtime } = world();
    const run = await runScheduled(runtime);
    expect([...run.expiries.keys()]).toEqual(['project-a', 'project-b', 'project-c']);
    expect(run.failedProjects).toEqual([]);
  });

  it('a Project whose retention fails is reported and does not stop the others or the usage comparison', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runtime } = world({ failing: ['project-b'], used: 5 });
    const run = await runScheduled(runtime);
    expect([...run.expiries.keys()]).toEqual(['project-a', 'project-c']);
    expect(run.failedProjects).toEqual(['project-b']);
    expect(run.usage).toEqual([{ product: 'workers_requests', used: 5, softLimit: 100, over: false }]);
  });

  it('Soft limit crossed -- Given Platform Usage above its Platform Soft Limit, When the scheduler compares usage, Then the operator is alerted', async () => {
    const { runtime, webhook } = world({ used: 101 });
    await runScheduled(runtime);
    expect(webhook.delivered.map((delivery) => delivery.destination)).toEqual([{ kind: 'webhook', url: 'https://ops.example/hook' }]);
  });
});
