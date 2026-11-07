/**
 * Schedule -- when a Cron Monitor expects its job to run (design Releases and
 * monitors, Cron Monitor). Either a crontab read in an IANA timezone, or a
 * fixed interval counted from a moment.
 *
 * A crontab has five fields: minute, hour, day of month, month, day of week
 * (0-7, both 0 and 7 being Sunday). Each field is `*`, a number, a range
 * `a-b`, any of those with a step `/n` (`a/n` runs from a to the field's
 * top), or a comma list of them. When both day of month and day of week are
 * restricted (do not start with `*`), a day matching either runs; otherwise
 * a day must match both.
 *
 * Timezone math uses `Intl.DateTimeFormat`, a pure built-in, to read an
 * instant's local wall time. Around a clock change:
 * - a local time the clock springs over never runs that day;
 * - a local time the clock falls back over runs once, at its first
 *   occurrence, when both minute and hour are fixed (neither starts with
 *   `*`); a schedule with a wildcard minute or hour runs on every instant
 *   whose local time matches, so a stepped minute keeps its spacing through the
 *   repeated hour.
 *
 * Times are epoch milliseconds. A crontab run falls on a whole minute.
 */

import { refusal, type Refusal } from '../refusal.js';

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week';

/** What a member writes: a crontab in a timezone, or an interval. */
export type ScheduleSpec =
  | { readonly kind: 'crontab'; readonly expression: string; readonly timezone: string }
  | { readonly kind: 'interval'; readonly every: number; readonly unit: IntervalUnit };

export type CrontabSchedule = {
  readonly kind: 'crontab';
  readonly timezone: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  /** 0 is Sunday. */
  readonly daysOfWeek: readonly number[];
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
  /** Neither minute nor hour is a wildcard: a repeated local time runs once. */
  readonly fixedTime: boolean;
};

export type IntervalSchedule = { readonly kind: 'interval'; readonly every: number; readonly unit: IntervalUnit };

export type Schedule = CrontabSchedule | IntervalSchedule;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNIT_MS: Readonly<Record<IntervalUnit, number>> = { minute: MINUTE, hour: HOUR, day: DAY, week: 7 * DAY };

type FieldBounds = { readonly min: number; readonly max: number };
const MINUTE_FIELD: FieldBounds = { min: 0, max: 59 };
const HOUR_FIELD: FieldBounds = { min: 0, max: 23 };
const DAY_OF_MONTH_FIELD: FieldBounds = { min: 1, max: 31 };
const MONTH_FIELD: FieldBounds = { min: 1, max: 12 };
const DAY_OF_WEEK_FIELD: FieldBounds = { min: 0, max: 7 };

/** Longest days in each month, February counting its leap day. */
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const NUMERAL = /^\d+$/;
const ITEM = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/;

/** Local days searched before giving up; covers the eight-year gap between some leap days. */
const SEARCH_DAYS = 9 * 366;
/** Wider than any UTC offset, so these bracket every instant of a local day. */
const OFFSET_SPAN_BEFORE = 14 * HOUR;
const OFFSET_SPAN_AFTER = DAY + 12 * HOUR;

// --- crontab parsing: predicates ---

function isUnrestricted(fieldText: string): boolean {
  return fieldText.startsWith('*');
}

function isIntervalUnit(unit: string): unit is IntervalUnit {
  return Object.hasOwn(UNIT_MS, unit);
}

function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function canEverRun(fields: Pick<CrontabSchedule, 'daysOfMonth' | 'months' | 'dayOfWeekRestricted'>): boolean {
  if (fields.dayOfWeekRestricted) return true;
  return fields.months.some((month) => fields.daysOfMonth.some((day) => day <= (MONTH_LENGTHS[month - 1] ?? 0)));
}

// --- crontab parsing: helpers ---

function range(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value += step) values.push(value);
  return values;
}

/** The values one comma-separated item names, or null when it is malformed or out of bounds. */
function parseItem(item: string, bounds: FieldBounds): number[] | null {
  const match = ITEM.exec(item);
  const base = match?.[1];
  if (base === undefined) return null;
  const step = match?.[2] === undefined ? 1 : Number(match[2]);
  if (step < 1) return null;
  if (base === '*') return range(bounds.min, bounds.max, step);
  const [fromText, toText] = base.split('-');
  const from = Number(fromText);
  const hasStepOnly = toText === undefined && match?.[2] !== undefined;
  const to = toText !== undefined ? Number(toText) : hasStepOnly ? bounds.max : from;
  if (from < bounds.min || to > bounds.max || from > to) return null;
  return range(from, to, step);
}

/** The sorted, distinct values a field names, or null when any item is malformed. */
function parseField(fieldText: string, bounds: FieldBounds): number[] | null {
  const values = new Set<number>();
  for (const item of fieldText.split(',')) {
    const itemValues = parseItem(item, bounds);
    if (itemValues === null) return null;
    for (const value of itemValues) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function parseCrontab(expression: string, timezone: string): CrontabSchedule | Refusal {
  const texts = expression.trim().split(/\s+/);
  const [minuteText, hourText, dayOfMonthText, monthText, dayOfWeekText] = texts;
  if (texts.length !== 5 || minuteText === undefined || hourText === undefined) return refusal('malformed-schedule');
  if (dayOfMonthText === undefined || monthText === undefined || dayOfWeekText === undefined) return refusal('malformed-schedule');
  const minutes = parseField(minuteText, MINUTE_FIELD);
  const hours = parseField(hourText, HOUR_FIELD);
  const daysOfMonth = parseField(dayOfMonthText, DAY_OF_MONTH_FIELD);
  const months = parseField(monthText, MONTH_FIELD);
  const weekdays = parseField(dayOfWeekText, DAY_OF_WEEK_FIELD);
  if (minutes === null || hours === null || daysOfMonth === null || months === null || weekdays === null) {
    return refusal('malformed-schedule');
  }
  if (!isKnownTimezone(timezone)) return refusal('unknown-timezone');
  const schedule: CrontabSchedule = {
    kind: 'crontab',
    timezone,
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek: [...new Set(weekdays.map((day) => day % 7))].sort((a, b) => a - b),
    dayOfMonthRestricted: !isUnrestricted(dayOfMonthText),
    dayOfWeekRestricted: !isUnrestricted(dayOfWeekText),
    fixedTime: !isUnrestricted(minuteText) && !isUnrestricted(hourText),
  };
  return canEverRun(schedule) ? schedule : refusal('schedule-never-runs');
}

function parseInterval(every: number, unit: string): IntervalSchedule | Refusal {
  if (!Number.isInteger(every) || every < 1 || !isIntervalUnit(unit)) return refusal('malformed-schedule');
  return { kind: 'interval', every, unit };
}

// --- next expected run: predicates ---

function isRunDay(schedule: CrontabSchedule, dayWall: number): boolean {
  const date = new Date(dayWall);
  if (!schedule.months.includes(date.getUTCMonth() + 1)) return false;
  const dayOfMonthMatches = schedule.daysOfMonth.includes(date.getUTCDate());
  const dayOfWeekMatches = schedule.daysOfWeek.includes(date.getUTCDay());
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) return dayOfMonthMatches || dayOfWeekMatches;
  return dayOfMonthMatches && dayOfWeekMatches;
}

// --- next expected run: helpers ---

function wallClock(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
}

/** An instant's local wall time in the formatter's timezone, written as if it were UTC. */
function wallTime(clock: Intl.DateTimeFormat, instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of clock.formatToParts(instant)) {
    if (NUMERAL.test(part.value)) parts[part.type] = Number(part.value);
  }
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  return (
    Date.UTC(
      parts['year'] ?? 0,
      (parts['month'] ?? 1) - 1,
      parts['day'] ?? 1,
      parts['hour'] ?? 0,
      parts['minute'] ?? 0,
      parts['second'] ?? 0,
    ) +
    (instant - wholeSecond)
  );
}

function offsetAt(clock: Intl.DateTimeFormat, instant: number): number {
  return wallTime(clock, instant) - instant;
}

/** Every wall time on a run day that the minute and hour fields name, ascending. */
function runWallTimes(schedule: CrontabSchedule, dayWall: number): number[] {
  return schedule.hours.flatMap((hour) => schedule.minutes.map((minute) => dayWall + hour * HOUR + minute * MINUTE));
}

/** The instants at which a local wall time occurs: none in a gap, two in a repeat (only the first when fixed). */
function instantsOf(params: { clock: Intl.DateTimeFormat; wall: number; offsets: readonly number[]; fixedTime: boolean }): number[] {
  const { clock, wall, offsets, fixedTime } = params;
  const candidates = [...new Set(offsets.map((offset) => wall - offset))].sort((a, b) => a - b);
  const occurrences = candidates.filter((instant) => wallTime(clock, instant) === wall);
  return fixedTime ? occurrences.slice(0, 1) : occurrences;
}

/** The earliest run instant after `after` on one local day, or null. */
function nextRunOnDay(params: { schedule: CrontabSchedule; clock: Intl.DateTimeFormat; dayWall: number; after: number }): number | null {
  const { schedule, clock, dayWall, after } = params;
  const offsetBefore = offsetAt(clock, dayWall - OFFSET_SPAN_BEFORE);
  const offsetAfter = offsetAt(clock, dayWall + OFFSET_SPAN_AFTER);
  const walls = runWallTimes(schedule, dayWall);
  if (offsetBefore === offsetAfter) {
    const wall = walls.find((candidate) => candidate - offsetBefore > after);
    return wall === undefined ? null : wall - offsetBefore;
  }
  const instants = walls.flatMap((wall) =>
    instantsOf({ clock, wall, offsets: [offsetBefore, offsetAfter], fixedTime: schedule.fixedTime }).filter((instant) => instant > after),
  );
  return instants.length === 0 ? null : Math.min(...instants);
}

function nextCrontabRun(schedule: CrontabSchedule, after: number): number {
  const clock = wallClock(schedule.timezone);
  const firstDayWall = Math.floor(wallTime(clock, after) / DAY) * DAY;
  for (let day = 0; day < SEARCH_DAYS; day++) {
    const dayWall = firstDayWall + day * DAY;
    if (!isRunDay(schedule, dayWall)) continue;
    const run = nextRunOnDay({ schedule, clock, dayWall, after });
    if (run !== null) return run;
  }
  // Unreachable for a Schedule parseSchedule accepted: it refuses one that can never run.
  throw new Error('schedule has no run within the search span');
}

// --- exports ---

/** Reads a ScheduleSpec, refusing a malformed crontab or interval, an unknown timezone, or a crontab that can never run. */
export function parseSchedule(spec: ScheduleSpec): Schedule | Refusal {
  return spec.kind === 'crontab' ? parseCrontab(spec.expression, spec.timezone) : parseInterval(spec.every, spec.unit);
}

/** The first run the Schedule expects strictly after `after` (epoch ms). */
export function nextExpectedRun(schedule: Schedule, after: number): number {
  if (schedule.kind === 'interval') return after + schedule.every * UNIT_MS[schedule.unit];
  return nextCrontabRun(schedule, after);
}
