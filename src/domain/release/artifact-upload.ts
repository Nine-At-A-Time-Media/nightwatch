/**
 * Artifact upload -- what CI sends to place a source map or bundle (design
 * Releases and monitors, Artifacts; Domain Language: Artifact). An upload
 * names a release, a debug id, or both, and the file name it was built
 * under. Its content hash is its Artifact id, and its bytes are kept under
 * `artifacts/<hash>`, so uploading the same content twice stores it once.
 * A debug id is kept in normalized form, the form the Artifact index is
 * searched by.
 */

import { isRefusal, refusal, type Refusal } from '../refusal.js';
import { normalizedDebugId, type Artifact } from '../sourcemap/artifact.js';
import type { Release } from './ordering.js';

export type ArtifactUpload = {
  readonly release: Release | null;
  readonly debugId: string | null;
  /** The name it was built under, such as `~/static/app.min.js.map`. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
};

const ARTIFACT_PREFIX = 'artifacts/';

// --- predicates ---

function isPlaced(release: Release | null, debugId: string | null): boolean {
  return Boolean(release) || Boolean(debugId);
}

// --- helpers ---

function placementRefusal(upload: ArtifactUpload, debugId: string | null): Refusal | null {
  if (!isPlaced(upload.release, debugId)) return refusal('artifact-unplaced');
  if (upload.fileName === '') return refusal('artifact-unnamed');
  if (upload.bytes.length === 0) return refusal('artifact-empty');
  return null;
}

// --- exports ---

/** An upload ready to store, its debug id normalized; refuses one with no release or debug id, no file name, or no content. */
export function parseArtifactUpload(upload: ArtifactUpload): ArtifactUpload | Refusal {
  const debugId = upload.debugId === null ? null : normalizedDebugId(upload.debugId) || null;
  const refused = placementRefusal(upload, debugId);
  if (isRefusal(refused)) return refused;
  return { release: upload.release || null, debugId, fileName: upload.fileName, bytes: upload.bytes };
}

/** The Artifact index entry for an upload whose content hashes to `contentHash`. */
export function artifactOf(upload: ArtifactUpload, contentHash: string): Artifact {
  return { id: contentHash, debugId: upload.debugId, release: upload.release, fileName: upload.fileName };
}

/** Where an Artifact's bytes are kept in the BlobStore. */
export function artifactKey(id: string): string {
  return ARTIFACT_PREFIX + id;
}
