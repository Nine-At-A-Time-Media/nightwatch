/**
 * R2NdjsonArchiveSink -- the ArchiveSink the local stage runs on, standing in
 * for Basin Pipelines (architecture A14). Each batch becomes one NDJSON object
 * per UTC day of `recordedAt`, at `archive/outcomes/dt=YYYY-MM-DD/<id>.ndjson`,
 * one Outcome per line. A failed write throws: archived Outcomes are exact.
 */

import type { Outcome } from '../../domain/outcome/outcome.js';
import type { ArchiveSink } from '../../ports/archive-sink.js';
import type { Ids } from '../../ports/ids.js';

// --- helpers ---

function dayOf(recordedAt: number): string {
  return new Date(recordedAt).toISOString().slice(0, 10);
}

/** Outcomes grouped by UTC day, days in first-seen order. */
function byDay(outcomes: readonly Outcome[]): Map<string, Outcome[]> {
  const days = new Map<string, Outcome[]>();
  for (const outcome of outcomes) {
    const day = dayOf(outcome.recordedAt);
    days.set(day, [...(days.get(day) ?? []), outcome]);
  }
  return days;
}

function ndjson(outcomes: readonly Outcome[]): string {
  return outcomes.map((outcome) => `${JSON.stringify(outcome)}\n`).join('');
}

export function archiveKey({ day, id }: { day: string; id: string }): string {
  return `archive/outcomes/dt=${day}/${id}.ndjson`;
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
    for (const [day, batch] of byDay(outcomes)) {
      await this.#bucket.put(archiveKey({ day, id: this.#ids.newId() }), ndjson(batch), {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
    }
  }
}
