import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Outcome, OutcomeKind } from '../../../../src/domain/outcome/outcome.js';
import { outcomeTotalsOf } from '../../../../src/domain/outcome/totals.js';
import { isWithinRange, type TimeRange } from '../../../../src/domain/time-range.js';

const T0 = Date.UTC(2026, 10, 1);
const HOUR = 3_600_000;
const range: TimeRange = { start: T0, end: T0 + 24 * HOUR };

function outcome(kind: OutcomeKind, reason: string | null, overrides: Partial<Outcome> = {}): Outcome {
  return { projectId: 'web', recordedAt: T0 + HOUR, kind, reason, category: 'error', quantity: 1, ...overrides };
}

describe('Time Range', () => {
  it('holds its start and not its end', () => {
    expect(isWithinRange(range.start, range)).toBe(true);
    expect(isWithinRange(range.end - 1, range)).toBe(true);
    expect(isWithinRange(range.end, range)).toBe(false);
    expect(isWithinRange(range.start - 1, range)).toBe(false);
  });
});

describe('outcomeTotalsOf', () => {
  it('sums quantities per kind and reason, kinds in the Outcome order, leaving out other Projects and times outside the range', () => {
    const totals = outcomeTotalsOf({
      projectId: 'web',
      range,
      outcomes: [
        outcome('rate_limited', 'quota-exceeded', { quantity: 3 }),
        outcome('accepted', null),
        outcome('accepted', null, { category: 'attachment', quantity: 2 }),
        outcome('filtered', 'localhost'),
        outcome('rate_limited', 'quota-exceeded'),
        outcome('invalid', 'too-large'),
        outcome('discarded', 'tombstone'),
        outcome('filtered', 'browser-extension'),
        outcome('accepted', null, { projectId: 'api' }),
        outcome('accepted', null, { recordedAt: range.end }),
      ],
    });
    expect(totals).toEqual({
      projectId: 'web',
      range,
      totals: [
        { kind: 'accepted', reason: null, quantity: 3 },
        { kind: 'filtered', reason: 'browser-extension', quantity: 1 },
        { kind: 'filtered', reason: 'localhost', quantity: 1 },
        { kind: 'rate_limited', reason: 'quota-exceeded', quantity: 4 },
        { kind: 'invalid', reason: 'too-large', quantity: 1 },
        { kind: 'discarded', reason: 'tombstone', quantity: 1 },
      ],
    });
  });

  it('keeps every unit of quantity of the Project in range, whatever the order the Outcomes come in', () => {
    const arbitrary = fc.array(
      fc.record({
        kind: fc.constantFrom<OutcomeKind>('accepted', 'filtered', 'rate_limited', 'invalid', 'discarded'),
        reason: fc.constantFrom(null, 'a', 'b'),
        quantity: fc.integer({ min: 1, max: 5 }),
        offset: fc.integer({ min: -HOUR, max: 25 * HOUR }),
      }),
    );
    fc.assert(
      fc.property(arbitrary, (specs) => {
        const outcomes = specs.map((spec) => outcome(spec.kind, spec.reason, { quantity: spec.quantity, recordedAt: T0 + spec.offset }));
        const inRange = outcomes.filter((held) => isWithinRange(held.recordedAt, range));
        const totals = outcomeTotalsOf({ projectId: 'web', range, outcomes });
        const reversed = outcomeTotalsOf({ projectId: 'web', range, outcomes: [...outcomes].reverse() });
        expect(totals.totals.reduce((sum, total) => sum + total.quantity, 0)).toBe(inRange.reduce((sum, held) => sum + held.quantity, 0));
        expect(reversed).toEqual(totals);
      }),
    );
  });

  it('counts an item admitted then discarded by processing once, as discarded: its processing Outcome supersedes its admission Outcome', () => {
    const item = { recordId: 'rec-1', index: 0 };
    const totals = outcomeTotalsOf({
      projectId: 'web',
      range,
      outcomes: [outcome('accepted', null, { item }), outcome('discarded', 'tombstone', { item })],
    });
    expect(totals.totals).toEqual([{ kind: 'discarded', reason: 'tombstone', quantity: 1 }]);
  });

  it('counts each item of a record once by its final Outcome, a redelivered refusal once, and a record-wide refusal in place of every item of its record', () => {
    const totals = outcomeTotalsOf({
      projectId: 'web',
      range,
      outcomes: [
        outcome('accepted', null, { item: { recordId: 'rec-1', index: 0 } }),
        outcome('accepted', null, { item: { recordId: 'rec-1', index: 1 } }),
        outcome('invalid', 'malformed-event', { item: { recordId: 'rec-1', index: 1 } }),
        outcome('invalid', 'malformed-event', { item: { recordId: 'rec-1', index: 1 } }),
        outcome('accepted', null, { item: { recordId: 'rec-2', index: 0 } }),
        outcome('accepted', null, { item: { recordId: 'rec-2', index: 1 } }),
        outcome('discarded', 'dead-letter', { item: { recordId: 'rec-2', index: null } }),
        outcome('filtered', 'localhost'),
        outcome('accepted', null, { quantity: 4 }),
      ],
    });
    expect(totals.totals).toEqual([
      { kind: 'accepted', reason: null, quantity: 5 },
      { kind: 'filtered', reason: 'localhost', quantity: 1 },
      { kind: 'invalid', reason: 'malformed-event', quantity: 1 },
      { kind: 'discarded', reason: 'dead-letter', quantity: 1 },
    ]);
  });

  it('counts every identified item exactly once, whatever Outcomes admission and processing archived for it and in whatever order', () => {
    const arbitrary = fc.array(
      fc.record({
        record: fc.constantFrom('rec-1', 'rec-2'),
        index: fc.integer({ min: 0, max: 3 }),
        refusals: fc.array(fc.constantFrom<OutcomeKind>('invalid', 'discarded'), { maxLength: 2 }),
      }),
    );
    fc.assert(
      fc.property(arbitrary, (specs) => {
        const outcomes = specs.flatMap((spec) => {
          const item = { recordId: spec.record, index: spec.index };
          return [outcome('accepted', null, { item }), ...spec.refusals.map((kind) => outcome(kind, 'r', { item }))];
        });
        const items = new Set(specs.map((spec) => `${spec.record}/${spec.index}`));
        const totals = outcomeTotalsOf({ projectId: 'web', range, outcomes });
        expect(totals.totals.reduce((sum, total) => sum + total.quantity, 0)).toBe(items.size);
        expect(outcomeTotalsOf({ projectId: 'web', range, outcomes: [...outcomes].reverse() })).toEqual(totals);
      }),
    );
  });
});
