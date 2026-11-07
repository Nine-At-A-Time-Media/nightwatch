import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareReleases, parseSemanticVersion } from '../../../../src/domain/release/ordering.js';

const noSightings = new Map<string, number>();

describe('parseSemanticVersion', () => {
  it('reads a package-qualified version with prerelease and build parts', () => {
    expect(parseSemanticVersion('web@1.2.3-beta.1+abc')).toEqual({ core: ['1', '2', '3'], prerelease: ['beta', '1'] });
    expect(parseSemanticVersion('@scope/pkg@10.0.0')).toEqual({ core: ['10', '0', '0'], prerelease: [] });
  });

  it('does not read a version that is not semantic', () => {
    expect(parseSemanticVersion('abc123')).toBeNull();
    expect(parseSemanticVersion('1.2')).toBeNull();
    expect(parseSemanticVersion('01.2.3')).toBeNull();
    expect(parseSemanticVersion('1.2.3-')).toBeNull();
  });
});

describe('compareReleases', () => {
  it('orders semantic versions by version, not by first sight', () => {
    // Given 1.10.0 was seen before 1.9.0, When compared, Then 1.10.0 is still newer.
    const seen = new Map([
      ['1.10.0', 1],
      ['1.9.0', 2],
    ]);
    expect(compareReleases('1.10.0', '1.9.0', seen)).toBe(1);
    expect(compareReleases('1.9.0', '1.10.0', seen)).toBe(-1);
  });

  it('orders a prerelease before its release, and prerelease identifiers per semantic versioning', () => {
    expect(compareReleases('1.0.0-rc.1', '1.0.0', noSightings)).toBe(-1);
    expect(compareReleases('1.0.0-alpha', '1.0.0-alpha.1', noSightings)).toBe(-1);
    expect(compareReleases('1.0.0-alpha.2', '1.0.0-alpha.10', noSightings)).toBe(-1);
    expect(compareReleases('1.0.0-alpha.10', '1.0.0-beta', noSightings)).toBe(-1);
    expect(compareReleases('1.0.0-1', '1.0.0-a', noSightings)).toBe(-1);
  });

  it('ignores the package name when both versions are semantic', () => {
    expect(compareReleases('web@2.0.0', 'api@1.0.0', noSightings)).toBe(1);
  });

  it('orders other versions by first sight, an unseen version being newest', () => {
    const seen = new Map([
      ['zeta', 1],
      ['alpha', 2],
    ]);
    expect(compareReleases('zeta', 'alpha', seen)).toBe(-1);
    expect(compareReleases('never-seen', 'alpha', seen)).toBe(1);
  });

  it('breaks a tie between equal versions by first sight', () => {
    const seen = new Map([
      ['1.0.0+b', 1],
      ['1.0.0+a', 2],
    ]);
    expect(compareReleases('1.0.0+b', '1.0.0+a', seen)).toBe(-1);
    expect(compareReleases('1.0.0+a', '1.0.0+a', seen)).toBe(0);
  });

  it('is a total order on semantic version strings', () => {
    const num = fc.oneof(fc.constantFrom('0', '1', '2', '10'), fc.nat({ max: 99999 }).map(String));
    const ident = fc.oneof(num, fc.constantFrom('alpha', 'beta', 'rc', 'x-1'));
    const semver = fc
      .tuple(
        num,
        num,
        num,
        fc.array(ident, { maxLength: 3 }),
        fc.option(fc.constantFrom('b1', 'b2'), { nil: undefined }),
        fc.option(fc.constantFrom('web@', '@s/p@'), { nil: undefined }),
      )
      .map(([a, b, c, pre, build, pkg]) => `${pkg ?? ''}${a}.${b}.${c}${pre.length ? '-' + pre.join('.') : ''}${build ? '+' + build : ''}`);
    fc.assert(
      fc.property(
        fc.array(semver, { minLength: 3, maxLength: 3 }),
        fc.array(fc.nat({ max: 3 }), { minLength: 3, maxLength: 3 }),
        (vs, times) => {
          const seen = new Map(vs.map((v, i) => [v, times[i] ?? 0]));
          const [a, b, c] = vs as [string, string, string];
          // Antisymmetric, and equal only for the same string.
          expect(Math.sign(compareReleases(a, b, seen))).toBe(-Math.sign(compareReleases(b, a, seen)));
          expect(compareReleases(a, b, seen) === 0).toBe(a === b);
          // Transitive.
          if (compareReleases(a, b, seen) <= 0 && compareReleases(b, c, seen) <= 0) {
            expect(compareReleases(a, c, seen)).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });
});
