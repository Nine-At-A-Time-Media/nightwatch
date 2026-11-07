// ArchiveQuery contract: the R2 NDJSON adapter (the local stand-in for Basin
// SQL, reading what R2NdjsonArchiveSink wrote) and the in-memory fake answer
// the same query with the same Outcomes: the Project's, recorded within the
// Time Range, across UTC day partitions.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { R2NdjsonArchiveQuery } from '../../../src/adapters/r2-ndjson/r2-ndjson-archive-query.js';
import { R2NdjsonArchiveSink } from '../../../src/adapters/r2-ndjson/r2-ndjson-archive-sink.js';
import type { Outcome } from '../../../src/domain/outcome/outcome.js';
import type { ArchiveQuery } from '../../../src/ports/archive-query.js';
import { FakeArchiveQuery } from '../../_fakes/fake-archive-query.js';
import { FakeIds } from '../../_fakes/fake-ids.js';

const DAY = 86_400_000;
const START = Date.UTC(2023, 10, 14, 12);

type Seeded = { query: ArchiveQuery; seed: (outcomes: readonly Outcome[]) => Promise<void> };

function outcome(projectId: string, recordedAt: number, overrides: Partial<Outcome> = {}): Outcome {
  return { projectId, recordedAt, kind: 'accepted', reason: null, category: 'error', quantity: 1, ...overrides };
}

describe.each<{ name: string; make: () => Seeded }>([
  {
    name: 'FakeArchiveQuery',
    make: () => {
      const fake = new FakeArchiveQuery();
      return { query: fake, seed: async (outcomes) => fake.seed(outcomes) };
    },
  },
  {
    name: 'R2NdjsonArchiveQuery',
    make: () => {
      const sink = new R2NdjsonArchiveSink({ bucket: env.BLOBS, ids: new FakeIds(crypto.randomUUID()) });
      return { query: new R2NdjsonArchiveQuery({ bucket: env.BLOBS }), seed: (outcomes) => sink.outcomes(outcomes) };
    },
  },
])('ArchiveQuery contract -- $name', ({ make }) => {
  it("answers the Project's Outcomes recorded within the range, across day partitions, and no other's", async () => {
    const project = crypto.randomUUID();
    const { query, seed } = make();
    const inRange = [
      outcome(project, START),
      outcome(project, START + 1, { item: { recordId: 'rec-1', index: 0 } }),
      outcome(project, START + 2, { kind: 'invalid', reason: 'raw-expired', item: { recordId: 'rec-1', index: null } }),
      outcome(project, START + 13 * 3_600_000, { kind: 'rate_limited', reason: 'quota-exceeded', quantity: 3 }),
      outcome(project, START + 2 * DAY - 1, { kind: 'filtered', reason: 'localhost' }),
    ];
    await seed([...inRange, outcome(project, START - 1), outcome(project, START + 2 * DAY), outcome(crypto.randomUUID(), START)]);

    const answered = await query.outcomes({ projectId: project, range: { start: START, end: START + 2 * DAY } });

    const order = (outcomes: readonly Outcome[]) => [...outcomes].sort((a, b) => a.recordedAt - b.recordedAt);
    expect(order(answered)).toEqual(inRange);
  });

  it('answers nothing for a range with no partitions', async () => {
    const { query } = make();
    expect(await query.outcomes({ projectId: crypto.randomUUID(), range: { start: START, end: START } })).toEqual([]);
  });
});
