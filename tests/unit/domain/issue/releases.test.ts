import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { recordCommitShipped, recordReleaseSeen } from '../../../../src/domain/issue/releases.js';
import { HOUR, T0, issueArbitrary, issueIn } from './fixtures.js';

const AT = T0 + HOUR;

describe('recordReleaseSeen', () => {
  it('Resolve in next release: Given an issue resolved in next release, When the next release is first seen, Then the Resolution names that release', () => {
    const pending = issueIn({ status: 'resolved', resolution: { kind: 'in_next_release', release: null } });
    const { state, changes } = recordReleaseSeen(pending, '2.0.0', AT);
    expect(state).toMatchObject({ status: 'resolved', resolution: { kind: 'in_next_release', release: '2.0.0' } });
    expect(changes).toEqual([
      {
        issueId: 'issue-1',
        kind: 'resolution',
        from: 'in_next_release',
        to: 'in_next_release:2.0.0',
        actor: 'system',
        origin: 'nightwatch',
        at: AT,
      },
    ]);
    // A later release does not rename it.
    expect(recordReleaseSeen(state, '2.1.0', AT)).toEqual({ state, changes: [] });
  });

  it('changes nothing for an issue with no pending next-release Resolution', () => {
    fc.assert(
      fc.property(issueArbitrary, (state) => {
        const pending = state.status === 'resolved' && state.resolution.kind === 'in_next_release' && state.resolution.release === null;
        if (!pending) expect(recordReleaseSeen(state, '3.0.0', AT)).toEqual({ state, changes: [] });
      }),
    );
  });
});

describe('recordCommitShipped', () => {
  it('names the release a pending commit Resolution shipped in, only for that commit', () => {
    const pending = issueIn({ status: 'resolved', resolution: { kind: 'in_commit', commit: 'abc', release: null } });
    expect(recordCommitShipped(pending, { commit: 'def', release: '2.0.0' }, AT)).toEqual({ state: pending, changes: [] });
    const { state, changes } = recordCommitShipped(pending, { commit: 'abc', release: '2.0.0' }, AT);
    expect(state).toMatchObject({ resolution: { kind: 'in_commit', commit: 'abc', release: '2.0.0' } });
    expect(changes[0]).toMatchObject({ kind: 'resolution', from: 'in_commit:abc', to: 'in_commit:abc:2.0.0', actor: 'commit' });
  });
});
