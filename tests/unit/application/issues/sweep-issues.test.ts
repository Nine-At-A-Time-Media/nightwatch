import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { sweepIssues } from '../../../../src/application/issues/sweep-issues.js';
import { computeForecast } from '../../../../src/domain/issue/forecast.js';
import { DAY, HOUR, MINUTE, T0, issueIdOf, stateOf, summary, world } from './world.js';

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function sweepDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, effects: w.effects, clock: w.clock, policies: w.policies };
}

describe('sweepIssues', () => {
  it('New becomes ongoing: Given a New issue, When it is older than the New Issue Age, Then it becomes Ongoing', async () => {
    const w = world({ policies: { newIssueAge: 3 * DAY } });
    const id = issueIdOf(await assignEvent(summary(T0), ['fp'], assignDeps(w)));
    w.clock.set(T0 + 3 * DAY);
    expect(await sweepIssues('project-1', sweepDeps(w))).toEqual([]);
    expect(await stateOf(w.issues, id)).toMatchObject({ substatus: 'new' });
    w.clock.set(T0 + 3 * DAY + 1);
    const changes = await sweepIssues('project-1', sweepDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'ongoing' });
    expect(changes).toContainEqual(expect.objectContaining({ issueId: id, kind: 'status', to: 'unresolved/ongoing', actor: 'sweep' }));
    expect(w.effects.enqueued).toEqual(changes);
    expect(w.issues.history).toEqual(expect.arrayContaining(changes));
  });

  it('Auto-resolve: Given a Project with an Auto-Resolve Age, When an issue is not seen for that age, Then it is resolved', async () => {
    const w = world({ policies: { autoResolveAge: 14 * DAY } });
    const stale = issueIdOf(await assignEvent(summary(T0), ['stale'], assignDeps(w)));
    const fresh = issueIdOf(await assignEvent(summary(T0 + 10 * DAY), ['fresh'], assignDeps(w)));
    w.clock.set(T0 + 15 * DAY);
    await sweepIssues('project-1', sweepDeps(w));
    expect(await stateOf(w.issues, stale)).toMatchObject({ status: 'resolved', resolution: { kind: 'plain' } });
    expect(await stateOf(w.issues, fresh)).toMatchObject({ status: 'unresolved' });
  });

  it('a Project without an Auto-Resolve Age never auto-resolves', async () => {
    const w = world({ policies: { autoResolveAge: null } });
    const id = issueIdOf(await assignEvent(summary(T0), ['fp'], assignDeps(w)));
    w.clock.set(T0 + 365 * DAY);
    await sweepIssues('project-1', sweepDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved' });
  });

  it('a second sweep at the same moment changes nothing and enqueues nothing more', async () => {
    const w = world({ policies: { autoResolveAge: DAY } });
    await assignEvent(summary(T0), ['fp'], assignDeps(w));
    w.clock.set(T0 + 30 * DAY);
    const first = await sweepIssues('project-1', sweepDeps(w));
    expect(first.length).toBeGreaterThan(0);
    expect(await sweepIssues('project-1', sweepDeps(w))).toEqual([]);
    expect(w.effects.enqueued).toEqual(first);
  });

  it('recomputes a stale Forecast from the hourly counts of its window, and leaves a fresh one alone', async () => {
    const forecast = { window: 4 * HOUR, spreadMultiple: 1, floor: 0, refreshInterval: HOUR };
    const w = world({ policies: { forecast } });
    const id = issueIdOf(await assignEvent(summary(T0), ['fp'], assignDeps(w)));
    for (const at of [T0 + MINUTE, T0 + 2 * HOUR, T0 + 2 * HOUR + MINUTE, T0 + 2 * HOUR + 2 * MINUTE]) {
      await assignEvent(summary(at), ['fp'], assignDeps(w));
    }
    w.clock.set(T0 + 4 * HOUR + 30 * MINUTE);
    await sweepIssues('project-1', sweepDeps(w));
    const computed = await w.issues.getForecast(id);
    expect(computed).toEqual({ ...computeForecast([2, 0, 3, 0], forecast), computedAt: T0 + 4 * HOUR + 30 * MINUTE });
    await assignEvent(summary(T0 + 4 * HOUR + 31 * MINUTE), ['fp'], assignDeps(w));
    w.clock.advance(HOUR - 1);
    await sweepIssues('project-1', sweepDeps(w));
    expect(await w.issues.getForecast(id)).toEqual(computed);
  });
});
