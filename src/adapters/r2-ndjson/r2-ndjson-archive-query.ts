/**
 * R2NdjsonArchiveQuery -- the ArchiveQuery the local stage runs on, standing
 * in for Basin SQL (architecture A14). Reads the NDJSON objects
 * R2NdjsonArchiveSink wrote under `archive/outcomes/dt=YYYY-MM-DD/`, one
 * partition per UTC day the Time Range touches, and answers the Project's
 * Outcomes recorded within the range. A line that is not an Outcome is
 * skipped and logged, never counted.
 */

import { z } from 'zod';
import type { ProjectId } from '../../domain/ids.js';
import type { Outcome } from '../../domain/outcome/outcome.js';
import { isWithinRange, type TimeRange } from '../../domain/time-range.js';
import type { ArchiveQuery } from '../../ports/archive-query.js';

const DAY = 86_400_000;

const OUTCOME_ROW = z.object({
  projectId: z.string(),
  recordedAt: z.number(),
  kind: z.enum(['accepted', 'filtered', 'rate_limited', 'invalid', 'discarded']),
  reason: z.string().nullable(),
  category: z.enum([
    'default',
    'error',
    'security',
    'attachment',
    'session',
    'feedback',
    'monitor',
    'transaction',
    'span',
    'replay',
    'profile',
    'metric',
    'client_report',
  ]),
  quantity: z.number(),
});

// --- helpers ---

/** The UTC days the range touches, as partition names, oldest first. */
function daysOf(range: TimeRange): readonly string[] {
  const days: string[] = [];
  for (let day = Math.floor(range.start / DAY) * DAY; day < range.end; day += DAY) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}

function partitionPrefix(day: string): string {
  return `archive/outcomes/dt=${day}/`;
}

function rowOf(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The Outcomes on the lines of one object; a line that is not one is logged and left out. */
function outcomesIn(text: string, key: string): readonly Outcome[] {
  const rows = text.split('\n').filter((line) => line !== '');
  return rows.flatMap((line) => {
    const parsed = OUTCOME_ROW.safeParse(rowOf(line));
    if (parsed.success) return [parsed.data];
    console.error(JSON.stringify({ event: 'archive-query.bad-row', key }));
    return [];
  });
}

// --- exports ---

export class R2NdjsonArchiveQuery implements ArchiveQuery {
  readonly #bucket: R2Bucket;

  constructor({ bucket }: { bucket: R2Bucket }) {
    this.#bucket = bucket;
  }

  async outcomes(query: { projectId: ProjectId; range: TimeRange }): Promise<readonly Outcome[]> {
    const keys = (await Promise.all(daysOf(query.range).map((day) => this.#keys(partitionPrefix(day))))).flat();
    const outcomes = (await Promise.all(keys.map((key) => this.#read(key)))).flat();
    return outcomes.filter((outcome) => outcome.projectId === query.projectId && isWithinRange(outcome.recordedAt, query.range));
  }

  async #keys(prefix: string): Promise<readonly string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const listed = await this.#bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
      keys.push(...listed.objects.map((object) => object.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
    return keys;
  }

  async #read(key: string): Promise<readonly Outcome[]> {
    const object = await this.#bucket.get(key);
    return object === null ? [] : outcomesIn(await object.text(), key);
  }
}
