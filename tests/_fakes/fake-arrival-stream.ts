// FakeArrivalStream -- ArrivalStream that keeps Arrival Records in memory, or fails when told to.
import type { ArrivalRecord, Durability } from '../../src/domain/ingest/arrival.js';
import type { ArrivalStream } from '../../src/ports/arrival-stream.js';

export class FakeArrivalStream implements ArrivalStream {
  readonly records: ArrivalRecord[] = [];
  failure: { retryable: boolean } | null = null;

  async append(record: ArrivalRecord): Promise<Durability> {
    if (this.failure) return { ok: false, retryable: this.failure.retryable };
    this.records.push(record);
    return { ok: true };
  }
}
