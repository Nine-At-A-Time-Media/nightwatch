// outcomeTotals -- the console's view of a Project's Outcomes, driven by its
// architecture signature over the in-memory ArchiveQuery.
import { describe, expect, it } from 'vitest';
import { outcomeTotals } from '../../../../src/application/operating/outcome-totals.js';
import type { Outcome, OutcomeKind } from '../../../../src/domain/outcome/outcome.js';
import { FakeArchiveQuery } from '../../../_fakes/fake-archive-query.js';

const T0 = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;

function outcome(kind: OutcomeKind, reason: string | null, overrides: Partial<Outcome> = {}): Outcome {
  return { projectId: 'web', recordedAt: T0 + DAY, kind, reason, category: 'error', quantity: 1, ...overrides };
}

describe('outcomeTotals', () => {
  it('Outcome totals: Given arrivals of every Outcome kind, When an operator views Outcomes for a Project, Then totals per kind and reason are shown', async () => {
    const archive = new FakeArchiveQuery();
    archive.seed([
      outcome('accepted', null, { quantity: 5 }),
      outcome('filtered', 'web-crawler'),
      outcome('rate_limited', 'quota-exceeded', { quantity: 2 }),
      outcome('invalid', 'too-large'),
      outcome('discarded', 'deferred'),
      outcome('accepted', null, { projectId: 'api' }),
      outcome('accepted', null, { recordedAt: T0 + 5 * DAY }),
    ]);

    const totals = await outcomeTotals('web', { start: T0, end: T0 + 2 * DAY }, { archive });

    expect(totals.totals).toEqual([
      { kind: 'accepted', reason: null, quantity: 5 },
      { kind: 'filtered', reason: 'web-crawler', quantity: 1 },
      { kind: 'rate_limited', reason: 'quota-exceeded', quantity: 2 },
      { kind: 'invalid', reason: 'too-large', quantity: 1 },
      { kind: 'discarded', reason: 'deferred', quantity: 1 },
    ]);
    expect(archive.queries).toEqual([{ projectId: 'web', range: { start: T0, end: T0 + 2 * DAY } }]);
  });

  it('Outcome totals: an item admitted and then discarded by processing is counted once, as discarded', async () => {
    const archive = new FakeArchiveQuery();
    const item = { recordId: 'rec-1', index: 0 };
    archive.seed([outcome('accepted', null, { item }), outcome('discarded', 'tombstone', { item })]);

    const totals = await outcomeTotals('web', { start: T0, end: T0 + 2 * DAY }, { archive });

    expect(totals.totals).toEqual([{ kind: 'discarded', reason: 'tombstone', quantity: 1 }]);
  });
});

