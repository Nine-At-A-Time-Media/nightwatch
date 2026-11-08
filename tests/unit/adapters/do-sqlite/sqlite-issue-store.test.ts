// The SQLite IssueStore's pure helpers: hourly buckets, the normal hourly
// rate, and which migrations are pending. The store itself is covered by the
// IssueStore contract under workerd (tests/integration/core).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ISSUE_STORE_MIGRATIONS, pendingMigrations } from '../../../../src/adapters/do-sqlite/issue-store-migrations.js';
import { hourlyBuckets, normalRate } from '../../../../src/adapters/do-sqlite/sqlite-issue-store.js';

const HOUR = 3_600_000;

describe('hourlyBuckets', () => {
  it('counts each time inside the whole hours from since, and none outside them', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e12 }),
        fc.integer({ min: 0, max: 48 * HOUR }),
        fc.array(fc.integer({ min: -2 * HOUR, max: 50 * HOUR })),
        (since, span, offsets) => {
          const until = since + span;
          const counts = hourlyBuckets({ times: offsets.map((offset) => since + offset), since, until });
          expect(counts).toHaveLength(Math.floor(span / HOUR));
          const inside = offsets.filter((offset) => offset >= 0 && offset < counts.length * HOUR).length;
          expect(counts.reduce((sum, count) => sum + count, 0)).toBe(inside);
        },
      ),
    );
  });
});

describe('normalRate', () => {
  it('is zero with no Events, and the Events per clock hour spanned otherwise', () => {
    expect(normalRate({ events: 0, first: 0, last: 0 })).toBe(0);
    expect(normalRate({ events: 6, first: 10 * HOUR + 5, last: 12 * HOUR + 1 })).toBe(2);
    expect(normalRate({ events: 3, first: 10 * HOUR, last: 10 * HOUR + HOUR - 1 })).toBe(3);
  });
});

describe('pendingMigrations', () => {
  it('is every migration from version 0, the ones after a version, and none at the latest', () => {
    expect(pendingMigrations(0).map((step) => step.version)).toEqual(ISSUE_STORE_MIGRATIONS.map((_, index) => index + 1));
    expect(pendingMigrations(1).map((step) => step.version)).toEqual(ISSUE_STORE_MIGRATIONS.slice(1).map((_, index) => index + 2));
    expect(pendingMigrations(ISSUE_STORE_MIGRATIONS.length)).toEqual([]);
  });
});
