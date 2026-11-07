import { describe, expect, it } from 'vitest';
import { applyCommits } from '../../../../src/application/tracker/apply-commits.js';
import { formatShortId } from '../../../../src/domain/issue/short-id.js';
import type { Commit } from '../../../../src/domain/release/commit.js';
import { crashIssue, githubDeps, HOUR, PROJECT, REPOSITORY, SLUG, T0, world, type World } from './world.js';

async function shortIdOf(w: World, issueId: string): Promise<string> {
  const counter = await w.projects.store(PROJECT).shortIdOf(issueId);
  if (counter === null) throw new Error('no short id');
  return formatShortId({ slug: SLUG, counter });
}

function commit(message: string, overrides: Partial<Commit> = {}): Commit {
  return { repository: REPOSITORY, hash: 'c0ffee1', message, release: null, ...overrides };
}

describe('applyCommits', () => {
  it('Resolve by commit: Given an issue with short id S, When a commit saying it fixes S is pushed, Then the issue is resolved pending that commit; When the commit ships in a release, Then the Resolution names that release', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const shortId = await shortIdOf(w, issueId);
    w.clock.set(T0 + HOUR);

    const pushed = await applyCommits([commit(`Guard the empty cart\n\nFixes ${shortId}`)], githubDeps(w));

    expect(pushed.find((change) => change.kind === 'status')).toMatchObject({ issueId, to: 'resolved', actor: 'commit', at: T0 + HOUR });
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({
      status: 'resolved',
      resolution: { kind: 'in_commit', commit: `${REPOSITORY}@c0ffee1`, release: null },
    });

    const shipped = await applyCommits([commit('Guard the empty cart', { release: '1.4.0' })], githubDeps(w));

    expect(shipped).toEqual([expect.objectContaining({ issueId, kind: 'resolution', to: `in_commit:${REPOSITORY}@c0ffee1:1.4.0` })]);
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({
      resolution: { kind: 'in_commit', commit: `${REPOSITORY}@c0ffee1`, release: '1.4.0' },
    });
    expect(w.effects.enqueued).toEqual(expect.arrayContaining([...pushed, ...shipped]));
  });

  it('resolves every Issue a commit names, and names the release even when the fixing commit already ships', async () => {
    const w = world();
    const first = await crashIssue(w);
    const second = await crashIssue(w);

    await applyCommits(
      [commit(`Fixes ${await shortIdOf(w, first)} and ${await shortIdOf(w, second)}`, { release: '2.0.0' })],
      githubDeps(w),
    );

    for (const issueId of [first, second]) {
      expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ resolution: { kind: 'in_commit', release: '2.0.0' } });
    }
  });

  it('changes nothing for a commit from a Repository no Organization connected, an unknown slug or Short Id, or an Issue already resolved', async () => {
    const w = world();
    const issueId = await crashIssue(w);
    const shortId = await shortIdOf(w, issueId);
    await applyCommits([commit(`fixes ${shortId}`, { hash: 'first' })], githubDeps(w));
    const enqueued = w.effects.enqueued.length;

    const changes = await applyCommits(
      [
        commit(`fixes ${shortId}`, { repository: 'stranger/repo' }),
        commit('fixes API-1, WEB-ZZZ'),
        commit(`fixes ${shortId}`, { hash: 'second' }),
      ],
      githubDeps(w),
    );

    expect(changes).toEqual([]);
    expect(w.effects.enqueued).toHaveLength(enqueued);
    expect(await w.projects.getIssue(PROJECT, issueId)).toMatchObject({ resolution: { kind: 'in_commit', commit: `${REPOSITORY}@first` } });
  });
});
