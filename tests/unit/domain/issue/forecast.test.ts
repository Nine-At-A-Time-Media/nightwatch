import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeForecast, exceedsForecast, forecastHours, isForecastDue } from '../../../../src/domain/issue/forecast.js';

const HOUR = 3_600_000;
const policy = { window: 4 * HOUR, spreadMultiple: 2, floor: 5, refreshInterval: HOUR };

describe('computeForecast', () => {
  it('sets the ceiling at the mean plus a multiple of the spread over the window', () => {
    // Given hourly counts 2, 4, 4, 4, 5, 5, 7, 9 and a window of the last four hours (5, 5, 7, 9),
    // Then mean 6.5 and spread sqrt(2.75) give a ceiling of 6.5 + 2 * 1.658...
    const forecast = computeForecast([2, 4, 4, 4, 5, 5, 7, 9], policy);
    expect(forecast.ceiling).toBeCloseTo(6.5 + 2 * Math.sqrt(2.75), 6);
  });

  it('never sets the ceiling below the floor', () => {
    expect(computeForecast([0, 0, 1, 0], policy).ceiling).toBe(5);
    expect(computeForecast([], policy).ceiling).toBe(5);
  });

  it('never sets the ceiling below the floor or the mean of the window', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 10_000 }), { maxLength: 48 }), (counts) => {
        const window = counts.slice(-4);
        const mean = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
        const { ceiling } = computeForecast(counts, policy);
        expect(ceiling).toBeGreaterThanOrEqual(policy.floor);
        expect(ceiling).toBeGreaterThanOrEqual(mean - 1e-9);
      }),
    );
  });
});

describe('exceedsForecast', () => {
  it('holds only for an hourly count above the ceiling', () => {
    expect(exceedsForecast({ ceiling: 10 }, 11)).toBe(true);
    expect(exceedsForecast({ ceiling: 10 }, 10)).toBe(false);
  });
});

describe('Forecast refresh', () => {
  it('is due when never computed or at least the refresh interval old', () => {
    expect(isForecastDue(null, 0, policy)).toBe(true);
    expect(isForecastDue(0, HOUR - 1, policy)).toBe(false);
    expect(isForecastDue(0, HOUR, policy)).toBe(true);
  });

  it('reads the window of whole hours ending at the start of the current hour', () => {
    expect(forecastHours(10 * HOUR + 59_000, policy)).toEqual({ since: 6 * HOUR, until: 10 * HOUR });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 45 }), (now) => {
        const { since, until } = forecastHours(now, policy);
        return until <= now && now - until < HOUR && until - since === policy.window;
      }),
    );
  });
});
