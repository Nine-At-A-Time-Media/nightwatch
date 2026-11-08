import { describe, expect, it } from 'vitest';
import { assignEvent } from '../../../../src/application/issues/assign-event.js';
import { recordReleaseSeen } from '../../../../src/application/issues/record-release-seen.js';
import { resolve } from '../../../../src/domain/issue/commands.js';
import { HOUR, T0, command, issueIdOf, stateOf, summary, world } from './world.js';

const member = { member: 'member-1' };

function assignDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, clock: w.clock, ids: w.ids, policies: w.policies };
}

function releaseDeps(w: ReturnType<typeof world>) {
  return { issues: w.issues, effects: w.effects, clock: w.clock };
}

async function resolvedInNextRelease(w: ReturnType<typeof world>, fingerprint: string): Promise<string> {
  const id = issueIdOf(await assignEvent(summary(T0, { release: '1.0.0' }), [fingerprint], assignDeps(w)));
  await command(w.issues, id, (s) => resolve(s, { kind: 'in_next_release', release: null }, member, T0));
  return id;
}

describe('recordReleaseSeen', () => {
  it('Resolve in next release: Given an issue resolved in next release, When the next release is first seen, Then the Resolution names that release', async () => {
    const w = world();
    const id = await resolvedInNextRelease(w, 'fp');
    w.clock.set(T0 + HOUR);
    const changes = await recordReleaseSeen('2.0.0', releaseDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved', resolution: { kind: 'in_next_release', release: '2.0.0' } });
    expect(changes).toEqual([
      {
        issueId: id,
        kind: 'resolution',
        from: 'in_next_release',
        to: 'in_next_release:2.0.0',
        actor: 'system',
        origin: 'nightwatch',
        at: T0 + HOUR,
      },
    ]);
    expect(w.effects.enqueued).toEqual(changes);
    expect(w.issues.history).toEqual(expect.arrayContaining(changes));
    expect((await w.issues.releaseFirstSeen()).get('2.0.0')).toBe(T0 + HOUR);
  });

  it('a release already seen names no Resolution made since', async () => {
    const w = world();
    await recordReleaseSeen('2.0.0', releaseDeps(w));
    const id = await resolvedInNextRelease(w, 'fp');
    expect(await recordReleaseSeen('2.0.0', releaseDeps(w))).toEqual([]);
    expect(await stateOf(w.issues, id)).toMatchObject({ resolution: { kind: 'in_next_release', release: null } });
    expect(w.effects.enqueued).toEqual([]);
  });

  it('once named, only an event from a newer release regresses the issue', async () => {
    const w = world();
    const id = await resolvedInNextRelease(w, 'fp');
    await assignEvent(summary(T0 + HOUR, { release: '1.0.0' }), ['fp'], assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved' });
    await recordReleaseSeen('2.0.0', releaseDeps(w));
    await assignEvent(summary(T0 + 2 * HOUR, { release: '2.0.0' }), ['fp'], assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'resolved' });
    await assignEvent(summary(T0 + 3 * HOUR, { release: '2.1.0' }), ['fp'], assignDeps(w));
    expect(await stateOf(w.issues, id)).toMatchObject({ status: 'unresolved', substatus: 'regressed' });
  });
});
