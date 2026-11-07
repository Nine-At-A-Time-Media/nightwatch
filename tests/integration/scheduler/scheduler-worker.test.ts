// The scheduler Worker in workerd: its Cron Trigger walks every Project in
// D1 and runs retention in each Project's ProjectDO, then compares Platform
// Usage (nothing is measured on the local stage).
import { applyD1Migrations, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { DurableProjectClient } from '../../../src/adapters/do/durable-project-client.js';
import type { Assignment } from '../../../src/domain/issue/assignment.js';
import scheduler from '../../../src/workers/scheduler/index.js';

const DAY = 86_400_000;

const projects = () => new DurableProjectClient({ namespace: env.PROJECT });

function issueIdOf(assignment: Assignment): string {
  if (!('issueId' in assignment) || typeof assignment.issueId !== 'string') throw new Error('not assigned to an issue');
  return assignment.issueId;
}

function assign(projectId: string, eventId: string, at: number): Promise<Assignment> {
  const summary = { eventId, at, release: null, environment: 'production', level: 'error', userKey: null, title: eventId, culprit: null };
  return projects().assignEvent(projectId, summary, [`fp-${eventId}`]);
}

async function seedProject(): Promise<string> {
  const organizationId = `org-${crypto.randomUUID()}`;
  const projectId = `project-${crypto.randomUUID()}`;
  await env.CONTROL.prepare('INSERT INTO organizations (organization_id) VALUES (?)').bind(organizationId).run();
  await env.CONTROL.prepare('INSERT INTO projects (project_id, organization_id) VALUES (?, ?)').bind(projectId, organizationId).run();
  return projectId;
}

async function tick(): Promise<void> {
  const ctx = createExecutionContext();
  await scheduler.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}

beforeAll(async () => {
  await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
});

describe('scheduler Worker', () => {
  it('Retention expiry -- Given an event older than Event Retention, When the scheduler runs and anyone asks for it, Then it is not found', async () => {
    const projectId = await seedProject();
    const expired = issueIdOf(await assign(projectId, 'event-old', Date.now() - 100 * DAY));
    const kept = issueIdOf(await assign(projectId, 'event-new', Date.now()));

    await tick();

    expect(await projects().getIssue(projectId, expired)).toBeNull();
    expect(await projects().countEvents(projectId, { issueId: kept, since: 0 })).toBe(1);
  });

  it("runs retention in every Organization's Projects", async () => {
    const [first, second] = [await seedProject(), await seedProject()];
    const expired = await Promise.all(
      [first, second].map(async (projectId) => issueIdOf(await assign(projectId, 'old', Date.now() - 100 * DAY))),
    );

    await tick();

    expect(await projects().getIssue(first, expired[0] ?? '')).toBeNull();
    expect(await projects().getIssue(second, expired[1] ?? '')).toBeNull();
  });
});
