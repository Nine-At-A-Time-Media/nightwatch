/**
 * Forecast -- the expected ceiling on an Issue's hourly event rate (design
 * Domain Language), computed from recent hourly counts under a
 * ForecastPolicy: the mean plus a multiple of the spread over the window,
 * never below the policy's floor.
 */

export type ForecastPolicy = {
  /** How much recent history the Forecast reads, in milliseconds (whole hours count). */
  readonly window: number;
  /** How many standard deviations above the mean the ceiling sits. */
  readonly spreadMultiple: number;
  /** The lowest ceiling a Forecast may have, in events per hour. */
  readonly floor: number;
  /** How often Forecasts are recomputed, in milliseconds. */
  readonly refreshInterval: number;
};

export type Forecast = { readonly ceiling: number };

const HOUR = 3_600_000;

// --- helpers ---

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function spread(values: readonly number[], average: number): number {
  return Math.sqrt(mean(values.map((v) => (v - average) ** 2)));
}

// --- exports ---

/** `hourlyCounts` are oldest first; the newest whole hours inside the window are read. */
export function computeForecast(hourlyCounts: readonly number[], policy: ForecastPolicy): Forecast {
  const hours = Math.floor(policy.window / HOUR);
  const recent = hours > 0 ? hourlyCounts.slice(-hours) : [];
  if (recent.length === 0) return { ceiling: policy.floor };
  const average = mean(recent);
  return { ceiling: Math.max(policy.floor, average + policy.spreadMultiple * spread(recent, average)) };
}

export function exceedsForecast(forecast: Forecast, hourlyCount: number): boolean {
  return hourlyCount > forecast.ceiling;
}
