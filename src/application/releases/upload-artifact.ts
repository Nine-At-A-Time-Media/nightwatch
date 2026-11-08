/**
 * uploadArtifact -- CI places a source map or bundle (design Behaviors:
 * Artifact upload; Releases and monitors, Artifacts). The token must carry
 * `project:releases`. The bytes are kept in the BlobStore under their
 * content hash, then the Artifact is indexed in the ControlStore within the
 * token's Organization, by debug id and by release and file name, where
 * processing finds it for matchArtifact. Same content, same key: an upload
 * is stored once however often it arrives. Bytes are stored before the
 * index names them, so the index never points at nothing. Ports:
 * ControlStore, BlobStore, Clock, Ids.
 */

import { isRefusal, refusal, type Refusal } from '../../domain/refusal.js';
import { artifactKey, artifactOf, parseArtifactUpload, type ArtifactUpload } from '../../domain/release/artifact-upload.js';
import type { Artifact } from '../../domain/sourcemap/artifact.js';
import type { AccessToken, Grant } from '../../domain/tenancy/access-token.js';
import type { BlobStore } from '../../ports/blob-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ControlStore } from '../../ports/control-store.js';
import type { Ids } from '../../ports/ids.js';
import { authorize } from './authorize.js';

export type UploadArtifactDeps = { control: ControlStore; blobs: BlobStore; clock: Clock; ids: Ids };

const NOT_STORED = refusal('artifact-not-stored');

// --- flow ---

async function store(upload: ArtifactUpload, grant: Grant, deps: UploadArtifactDeps): Promise<Artifact | Refusal> {
  const artifact = artifactOf(upload, await deps.ids.hashContent(upload.bytes));
  const kept = await deps.blobs.put(artifactKey(artifact.id), upload.bytes);
  if (!kept.ok) return NOT_STORED;
  const indexed = await deps.control.putArtifact(grant.organizationId, artifact);
  return indexed.ok ? artifact : NOT_STORED;
}

// --- exports ---

export async function uploadArtifact(upload: ArtifactUpload, token: AccessToken, deps: UploadArtifactDeps): Promise<Artifact | Refusal> {
  const grant = await authorize(token, 'project:releases', deps);
  if (isRefusal(grant)) return grant;
  const parsed = parseArtifactUpload(upload);
  if (isRefusal(parsed)) return parsed;
  return store(parsed, grant, deps);
}
