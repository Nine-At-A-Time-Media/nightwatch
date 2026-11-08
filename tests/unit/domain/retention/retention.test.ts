import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isOrderedRetention, isPastRetention, retentionCutoff, type RetentionPolicy } from '../../../../src/domain/retention/retention.js';

const DAY = 86_400_000;

const policy: RetentionPolicy = {
  raw: 7 * DAY,
  event: 90 * DAY,
  attachment: 30 * DAY,
  report: 180 * DAY,
  outcome: 90 * DAY,
  history: 90 * DAY,
};

describe('retention', () => {
  it('a time is past its window only when it is older than the window before now', () => {
    const now = 1_000 * DAY;
    expect(isPastRetention({ at: now - 90 * DAY, window: 90 * DAY, now })).toBe(false);
    expect(isPastRetention({ at: now - 90 * DAY - 1, window: 90 * DAY, now })).toBe(true);
    expect(retentionCutoff({ window: 90 * DAY, now })).toBe(now - 90 * DAY);
  });

  it('agrees with the cutoff for every time, window and now', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), (at, window, now) => {
        expect(isPastRetention({ at, window, now })).toBe(at < retentionCutoff({ window, now }));
      }),
    );
  });

  it('holds the design Order: Raw and Attachment Retention within Event Retention, Report Retention at least Event Retention', () => {
    expect(isOrderedRetention(policy)).toBe(true);
    expect(isOrderedRetention({ ...policy, raw: 91 * DAY })).toBe(false);
    expect(isOrderedRetention({ ...policy, attachment: 91 * DAY })).toBe(false);
    expect(isOrderedRetention({ ...policy, report: 89 * DAY })).toBe(false);
  });
});
