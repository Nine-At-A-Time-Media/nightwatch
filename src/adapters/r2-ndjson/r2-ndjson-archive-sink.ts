/**
 * R2NdjsonArchiveSink -- the ArchiveSink the local stage runs on, standing in
 * for Basin Pipelines (architecture A14). Each batch becomes one NDJSON object
 * per UTC day, at `archive/<table>/dt=YYYY-MM-DD/<id>.ndjson`, one row per
 * line: Outcomes under `outcomes` by `recordedAt`, Event Summaries under
 * `events` by their time, each row naming its Project. A failed write throws:
 * archived Outcomes are exact.
 */

import type { EventSummary } from '../../domain/event/event-summary.js';
import type { ProjectId } from '../../domain/ids.js';
import type { Outcome } from '../../domain/outcome/outcome.js';
import type { ArchiveSink } from '../../ports/archive-sink.js';
import type { Ids } from '../../ports/ids.js';

type Table = 'outcomes' | 'events';

// --- helpers ---

function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Rows grouped by the UTC day of their time, days in first-seen order. */
function byDay<T>(rows: readonly T[], timeOf: (row: T) => number): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const row of rows) {
    const day = dayOf(timeOf(row));
    days.set(day, [...(days.get(day) ?? []), row]);
  }
  return days;
}

function ndjson(rows: readonly unknown[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
}

export function archiveKey({ table, day, id }: { table: Table; day: string; id: string }): string {
  return `archive/${table}/dt=${day}/${id}.ndjson`;
}

// --- exports ---

export class R2NdjsonArchiveSink implements ArchiveSink {
  readonly #bucket: R2Bucket;
  readonly #ids: Ids;

  constructor({ bucket, ids }: { bucket: R2Bucket; ids: Ids }) {
    this.#bucket = bucket;
    this.#ids = ids;
  }

  async outcomes(outcomes: readonly Outcome[]): Promise<void> {
    await this.#write(
      'outcomes',
      byDay(outcomes, (outcome) => outcome.recordedAt),
    );
  }

  async events(projectId: ProjectId, summaries: readonly EventSummary[]): Promise<void> {
    const rows = summaries.map((summary) => ({ projectId, ...summary }));
    await this.#write(
      'events',
      byDay(rows, (row) => row.at),
    );
  }

  async #write(table: Table, days: ReadonlyMap<string, readonly unknown[]>): Promise<void> {
    for (const [day, batch] of days) {
      await this.#bucket.put(archiveKey({ table, day, id: this.#ids.newId() }), ndjson(batch), {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
    }
  }
}
