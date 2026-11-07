import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { nextExpectedRun, parseSchedule, type Schedule } from '../../../../src/domain/monitor/schedule.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function crontab(expression: string, timezone = 'UTC'): Schedule {
  const parsed = parseSchedule({ kind: 'crontab', expression, timezone });
  if (isRefusal(parsed)) throw new Error(`fixture refused: ${parsed.refusal}`);
  return parsed;
}

function at(iso: string): number {
  return Date.parse(iso);
}

describe('parseSchedule', () => {
  it('reads a crontab with stars, lists, ranges and steps', () => {
    expect(isRefusal(parseSchedule({ kind: 'crontab', expression: '*/15 9-17/4 1,15 1-6 1-5', timezone: 'UTC' }))).toBe(false);
    expect(isRefusal(parseSchedule({ kind: 'crontab', expression: '0 0 * * 7', timezone: 'Europe/Berlin' }))).toBe(false);
  });

  it('refuses a malformed crontab', () => {
    const bad = [
      '',
      '* * * *',
      '* * * * * *',
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * * 13 *',
      '* * * * 8',
      '*/0 * * * *',
      '5-1 * * * *',
      'a * * * *',
      '1,,2 * * * *',
      '-1 * * * *',
      '1-2-3 * * * *',
    ];
    for (const expression of bad) {
      expect(parseSchedule({ kind: 'crontab', expression, timezone: 'UTC' })).toEqual({ refusal: 'malformed-schedule' });
    }
  });

  it('refuses a crontab that can never run', () => {
    expect(parseSchedule({ kind: 'crontab', expression: '0 0 30 2 *', timezone: 'UTC' })).toEqual({ refusal: 'schedule-never-runs' });
    expect(parseSchedule({ kind: 'crontab', expression: '0 0 31 4,6,9,11 *', timezone: 'UTC' })).toEqual({
      refusal: 'schedule-never-runs',
    });
  });

  it('refuses a timezone that is not an IANA name', () => {
    expect(parseSchedule({ kind: 'crontab', expression: '* * * * *', timezone: 'Mars/Olympus' })).toEqual({ refusal: 'unknown-timezone' });
  });

  it('refuses an interval that is not a positive whole number of a known unit', () => {
    expect(parseSchedule({ kind: 'interval', every: 0, unit: 'minute' })).toEqual({ refusal: 'malformed-schedule' });
    expect(parseSchedule({ kind: 'interval', every: 1.5, unit: 'hour' })).toEqual({ refusal: 'malformed-schedule' });
    expect(parseSchedule({ kind: 'interval', every: 2, unit: 'fortnight' as 'week' })).toEqual({ refusal: 'malformed-schedule' });
  });

  it('refuses malformed crontabs (property: any field out of range is refused)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 10_000 }), (minute) => {
        expect(isRefusal(parseSchedule({ kind: 'crontab', expression: `${minute} * * * *`, timezone: 'UTC' }))).toBe(true);
      }),
    );
  });
});

describe('nextExpectedRun', () => {
  it('finds the next whole hour for an hourly crontab', () => {
    expect(nextExpectedRun(crontab('0 * * * *'), at('2026-11-07T10:20:00Z'))).toBe(at('2026-11-07T11:00:00Z'));
    expect(nextExpectedRun(crontab('0 * * * *'), at('2026-11-07T11:00:00Z'))).toBe(at('2026-11-07T12:00:00Z'));
  });

  it('reads the crontab in its timezone', () => {
    // Friday afternoon in New York; weekdays at 09:30 local, EST is UTC-5.
    expect(nextExpectedRun(crontab('30 9 * * 1-5', 'America/New_York'), at('2026-11-06T15:00:00Z'))).toBe(at('2026-11-09T14:30:00Z'));
  });

  it('runs when either day-of-month or day-of-week matches, if both are restricted', () => {
    const tenthOrFriday = crontab('0 0 10 * 5');
    expect(nextExpectedRun(tenthOrFriday, at('2026-11-07T00:00:00Z'))).toBe(at('2026-11-10T00:00:00Z'));
    expect(nextExpectedRun(tenthOrFriday, at('2026-11-10T01:00:00Z'))).toBe(at('2026-11-13T00:00:00Z'));
  });

  it('treats day-of-week 7 as Sunday, and steps a month list', () => {
    expect(nextExpectedRun(crontab('0 12 * * 7'), at('2026-11-07T00:00:00Z'))).toBe(at('2026-11-08T12:00:00Z'));
    expect(nextExpectedRun(crontab('0 0 1 1,7 *'), at('2026-11-07T00:00:00Z'))).toBe(at('2027-01-01T00:00:00Z'));
  });

  it('skips a local time the clock springs over', () => {
    // 2026-03-08 02:30 does not exist in New York; the next 02:30 is the 9th, EDT (UTC-4).
    expect(nextExpectedRun(crontab('30 2 * * *', 'America/New_York'), at('2026-03-08T05:00:00Z'))).toBe(at('2026-03-09T06:30:00Z'));
  });

  it('runs a repeated local time once, at its first occurrence', () => {
    const nightly = crontab('30 1 * * *', 'America/New_York');
    // 2026-11-01 01:30 happens twice in New York: 05:30Z (EDT) and 06:30Z (EST).
    expect(nextExpectedRun(nightly, at('2026-11-01T04:00:00Z'))).toBe(at('2026-11-01T05:30:00Z'));
    expect(nextExpectedRun(nightly, at('2026-11-01T05:30:00Z'))).toBe(at('2026-11-02T06:30:00Z'));
  });

  it('keeps a stepped minute running through a repeated local hour', () => {
    // 01:55 EDT is followed by 01:00 EST, five minutes later.
    expect(nextExpectedRun(crontab('*/5 * * * *', 'America/New_York'), at('2026-11-01T05:55:00Z'))).toBe(at('2026-11-01T06:00:00Z'));
  });

  it('adds the interval for an interval schedule', () => {
    const after = at('2026-11-07T10:20:30Z');
    expect(nextExpectedRun({ kind: 'interval', every: 2, unit: 'hour' }, after)).toBe(after + 2 * HOUR);
    expect(nextExpectedRun({ kind: 'interval', every: 1, unit: 'week' }, after)).toBe(after + 7 * 24 * HOUR);
    expect(nextExpectedRun({ kind: 'interval', every: 45, unit: 'minute' }, after)).toBe(after + 45 * MINUTE);
    expect(nextExpectedRun({ kind: 'interval', every: 3, unit: 'day' }, after)).toBe(after + 72 * HOUR);
  });

  it('is always later than the time it starts from (property)', () => {
    const expressions = [
      '* * * * *',
      '*/7 * * * *',
      '0 */3 * * *',
      '15 4 1 * *',
      '0 0 29 2 *',
      '5 0 * * 0',
      '0 9-17 * * 1-5',
      '0 0 10 * 5',
    ];
    const timezones = ['UTC', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata'];
    fc.assert(
      fc.property(
        fc.constantFrom(...expressions),
        fc.constantFrom(...timezones),
        fc.integer({ min: at('2000-01-01T00:00:00Z'), max: at('2090-01-01T00:00:00Z') }),
        (expression, timezone, after) => {
          const next = nextExpectedRun(crontab(expression, timezone), after);
          expect(next).toBeGreaterThan(after);
          expect(next % MINUTE).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('spaces */n minutes n minutes apart (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30),
        fc.constantFrom('UTC', 'America/New_York'),
        fc.integer({ min: at('2000-01-01T00:00:00Z'), max: at('2090-01-01T00:00:00Z') }),
        (n, timezone, after) => {
          const schedule = crontab(`*/${n} * * * *`, timezone);
          const first = nextExpectedRun(schedule, after);
          expect(first - after).toBeLessThanOrEqual(n * MINUTE);
          expect(nextExpectedRun(schedule, first) - first).toBe(n * MINUTE);
        },
      ),
      { numRuns: 200 },
    );
  });
});
