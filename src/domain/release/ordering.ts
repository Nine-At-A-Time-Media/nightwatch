/**
 * Release ordering -- which of two Releases is newer (design Releases and
 * monitors, Release). Versions that parse as semantic versions order by
 * version; others order by first sight. A version may carry a package prefix
 * (`pkg@1.2.3`) and build metadata (`+build`), neither of which orders.
 *
 * Ties (equal semantic versions differing only in package or build, or two
 * versions seen at the same moment) break by first sight and then by the
 * version string, so distinct Releases never compare equal. A Release never
 * seen orders as the newest, since it is being seen now. Comparing a
 * semantic version with a non-semantic one falls back to first sight; the
 * order is transitive within each family, not across a mix of them.
 */

/** A Release, identified by its version within an Organization. */
export type Release = string;

/** When each Release was first seen, in epoch milliseconds. */
export type ReleaseFirstSeen = ReadonlyMap<Release, number>;

export type SemanticVersion = {
  readonly core: readonly [string, string, string];
  readonly prerelease: readonly string[];
};

const NUMBER = '(?:0|[1-9]\\d*)';
const PRERELEASE_IDENT = `(?:${NUMBER}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(
  `^(?:.*@)?(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${PRERELEASE_IDENT}(?:\\.${PRERELEASE_IDENT})*))?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
);
const NUMERIC = /^\d+$/;

// --- predicates ---

function isNumeric(ident: string): boolean {
  return NUMERIC.test(ident);
}

// --- helpers ---

function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** Compares digit strings of any length without converting to numbers. */
function compareNumerals(a: string, b: string): number {
  if (a.length !== b.length) return sign(a.length - b.length);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrereleaseIdent(a: string, b: string): number {
  const numericA = isNumeric(a);
  const numericB = isNumeric(b);
  if (numericA && numericB) return compareNumerals(a, b);
  if (numericA) return -1;
  if (numericB) return 1;
  return compareText(a, b);
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return sign(b.length - a.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = comparePrereleaseIdent(a[i] ?? '', b[i] ?? '');
    if (c !== 0) return c;
  }
  return sign(a.length - b.length);
}

export function parseSemanticVersion(release: Release): SemanticVersion | null {
  const match = SEMVER.exec(release);
  if (!match) return null;
  const [, major = '', minor = '', patch = '', prerelease] = match;
  return { core: [major, minor, patch], prerelease: prerelease ? prerelease.split('.') : [] };
}

export function compareSemanticVersions(a: SemanticVersion, b: SemanticVersion): number {
  for (let i = 0; i < 3; i++) {
    const c = compareNumerals(a.core[i] ?? '', b.core[i] ?? '');
    if (c !== 0) return c;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function compareFirstSight(a: Release, b: Release, firstSeen: ReleaseFirstSeen): number {
  return sign((firstSeen.get(a) ?? Infinity) - (firstSeen.get(b) ?? Infinity));
}

// --- exports ---

/** Negative when `a` is older than `b`, positive when newer, zero only when they are the same Release. */
export function compareReleases(a: Release, b: Release, firstSeen: ReleaseFirstSeen): number {
  if (a === b) return 0;
  const versionA = parseSemanticVersion(a);
  const versionB = parseSemanticVersion(b);
  const byVersion = versionA && versionB ? compareSemanticVersions(versionA, versionB) : 0;
  return byVersion || compareFirstSight(a, b, firstSeen) || compareText(a, b);
}

/** The newest Release seen, or null when none was. */
export function latestReleaseOf(firstSeen: ReleaseFirstSeen): Release | null {
  return [...firstSeen.keys()].reduce<Release | null>(
    (latest, release) => (latest === null || compareReleases(release, latest, firstSeen) > 0 ? release : latest),
    null,
  );
}
