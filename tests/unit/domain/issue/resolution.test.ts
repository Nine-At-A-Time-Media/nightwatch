import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isPendingResolution, isRegression } from '../../../../src/domain/issue/resolution.js';

const seen = new Map([
  ['build-a', 1],
  ['build-b', 2],
]);

describe('Regression Policy', () => {
  it('a plain Resolution regresses on any new event', () => {
    expect(isRegression({ kind: 'plain' }, null, seen)).toBe(true);
    expect(isRegression({ kind: 'plain' }, '0.0.1', seen)).toBe(true);
  });

  it('Regression in newer release: an event from a release newer than R regresses an issue resolved in R', () => {
    expect(isRegression({ kind: 'in_release', release: '1.2.0' }, '1.10.0', seen)).toBe(true);
    expect(isRegression({ kind: 'in_release', release: 'build-a' }, 'build-b', seen)).toBe(true);
  });

  it('No regression from older release: an event from R or older leaves an issue resolved in R resolved', () => {
    expect(isRegression({ kind: 'in_release', release: '1.10.0' }, '1.9.0', seen)).toBe(false);
    expect(isRegression({ kind: 'in_release', release: '1.10.0' }, '1.10.0', seen)).toBe(false);
    expect(isRegression({ kind: 'in_release', release: 'build-b' }, 'build-a', seen)).toBe(false);
  });

  it('an event with no release regresses an issue resolved in a release', () => {
    expect(isRegression({ kind: 'in_release', release: '1.0.0' }, null, seen)).toBe(true);
  });

  it('a pending Resolution never regresses; once it names a release it behaves as resolved in that release', () => {
    expect(isRegression({ kind: 'in_next_release', release: null }, '9.9.9', seen)).toBe(false);
    expect(isRegression({ kind: 'in_commit', commit: 'abc', release: null }, null, seen)).toBe(false);
    expect(isRegression({ kind: 'in_next_release', release: '2.0.0' }, '2.0.1', seen)).toBe(true);
    expect(isRegression({ kind: 'in_commit', commit: 'abc', release: '2.0.0' }, '1.0.0', seen)).toBe(false);
  });

  it('of two distinct releases, exactly one regresses an issue resolved in the other, and none regresses its own', () => {
    const version = fc.tuple(fc.nat(20), fc.nat(20), fc.nat(20)).map(([a, b, c]) => `${a}.${b}.${c}`);
    fc.assert(
      fc.property(version, version, (a, b) => {
        expect(isRegression({ kind: 'in_release', release: a }, a, seen)).toBe(false);
        if (a !== b) {
          expect(isRegression({ kind: 'in_release', release: a }, b, seen)).toBe(!isRegression({ kind: 'in_release', release: b }, a, seen));
        }
      }),
    );
  });

  it('a Resolution is pending while it waits for a release to name', () => {
    expect(isPendingResolution({ kind: 'in_next_release', release: null })).toBe(true);
    expect(isPendingResolution({ kind: 'in_commit', commit: 'abc', release: null })).toBe(true);
    expect(isPendingResolution({ kind: 'in_next_release', release: '1.0.0' })).toBe(false);
    expect(isPendingResolution({ kind: 'plain' })).toBe(false);
  });
});
