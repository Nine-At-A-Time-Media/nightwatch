/**
 * ArrivalStream -- the seam for the durable arrival log. An append that
 * reports ok is durable.
 */

import type { ArrivalRecord, Durability } from '../domain/ingest/arrival.js';

export interface ArrivalStream {
  append(record: ArrivalRecord): Promise<Durability>;
}
