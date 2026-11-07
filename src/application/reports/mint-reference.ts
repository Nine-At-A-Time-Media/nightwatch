/**
 * mintReference -- issues a Report Reference for a Report (design Reports,
 * Reference; architecture Mechanism, Reports): random, unguessable bits from
 * Ids, encoded by the report domain, and indexed in the ControlStore by its
 * hash alone. Since only the hash is kept, a reference cannot be shown
 * again; a later notice or listing mints another for the same Report, and
 * each is revoked with the Report. Ports: Ids, ControlStore.
 */

import type { Durability } from '../../domain/ingest/arrival.js';
import { encodeReference, REFERENCE_BYTES, type ReportReference } from '../../domain/report/reference.js';
import type { ControlStore, ReferenceEntry } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';

export type MintReferenceDeps = { ids: Ids; control: ControlStore };

export type MintedReference = { readonly reference: ReportReference; readonly hash: string; readonly stored: Durability };

// --- exports ---

export async function mintReference(entry: ReferenceEntry, deps: MintReferenceDeps): Promise<MintedReference> {
  const reference = encodeReference(deps.ids.randomBytes(REFERENCE_BYTES));
  if (reference === null) throw new Error(`Ids gave the wrong number of bytes for a Report Reference`);
  const hash = await deps.ids.hashReference(reference);
  return { reference, hash, stored: await deps.control.putReference(hash, entry) };
}
