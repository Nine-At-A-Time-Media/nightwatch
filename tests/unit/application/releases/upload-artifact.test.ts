import { describe, expect, it } from 'vitest';
import { uploadArtifact } from '../../../../src/application/releases/upload-artifact.js';
import type { Frame } from '../../../../src/domain/normalize/normalized-event.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import { artifactKey, type ArtifactUpload } from '../../../../src/domain/release/artifact-upload.js';
import { matchArtifact, normalizedDebugId } from '../../../../src/domain/sourcemap/artifact.js';
import { CI_TOKEN_SCOPES } from '../../../../src/domain/tenancy/access-token.js';
import { issueToken, ORG, OTHER_ORG, world } from './world.js';

const SOURCE_MAP = new TextEncoder().encode('{"version":3,"sources":["app.ts"],"mappings":"AAAA"}');
const BUNDLE_URL = 'https://cdn.example/static/app.min.js';
const frame: Frame = { absPath: BUNDLE_URL, lineno: 1, colno: 1 };

function sourceMap(overrides: Partial<ArtifactUpload> = {}): ArtifactUpload {
  return { release: 'web@1.0.0', debugId: null, fileName: '~/static/app.min.js.map', bytes: SOURCE_MAP, ...overrides };
}

describe('uploadArtifact', () => {
  it('Artifact upload: Given a CI token, When CI uploads a source map for a release, Then later events of that release are mapped with it', async () => {
    const w = world();
    const ci = await issueToken(w, 'nw_ci_secret', { scopes: CI_TOKEN_SCOPES });

    const artifact = await uploadArtifact(sourceMap(), ci, w);
    if (isRefusal(artifact)) throw new Error(artifact.refusal);

    const indexed = await w.control.findArtifacts({ organizationId: ORG, debugIds: [], release: 'web@1.0.0' });
    const matched = matchArtifact(frame, { debugImages: [], release: 'web@1.0.0' }, indexed);
    expect(matched).toEqual(artifact);
    expect(await w.blobs.get(artifactKey(artifact.id))).toEqual(SOURCE_MAP);
    expect(matchArtifact(frame, { debugImages: [], release: 'web@2.0.0' }, indexed)).toBeNull();
  });

  it('indexes an upload by debug id, so an event with that debug image maps with it', async () => {
    const w = world();
    const ci = await issueToken(w, 'nw_ci_secret', { scopes: CI_TOKEN_SCOPES });
    const debugId = 'C0FFEE00-1111-2222-3333-444455556666';
    const artifact = await uploadArtifact(sourceMap({ release: null, debugId }), ci, w);
    if (isRefusal(artifact)) throw new Error(artifact.refusal);

    const indexed = await w.control.findArtifacts({ organizationId: ORG, debugIds: [normalizedDebugId(debugId)], release: null });
    const debugImages = [{ type: 'sourcemap', debugId: debugId.toLowerCase(), codeFile: BUNDLE_URL }];
    expect(matchArtifact(frame, { debugImages, release: null }, indexed)).toEqual(artifact);
  });

  it('deduplicates uploads by content', async () => {
    const w = world();
    const ci = await issueToken(w, 'nw_ci_secret', { scopes: CI_TOKEN_SCOPES });
    const first = await uploadArtifact(sourceMap(), ci, w);
    const again = await uploadArtifact(sourceMap({ bytes: new Uint8Array(SOURCE_MAP) }), ci, w);
    const elsewhere = await uploadArtifact(sourceMap({ release: 'web@1.0.1' }), ci, w);
    if (isRefusal(first) || isRefusal(again) || isRefusal(elsewhere)) throw new Error('refused');

    expect(again).toEqual(first);
    expect(elsewhere.id).toBe(first.id);
    expect([...w.blobs.blobs.keys()]).toEqual([artifactKey(first.id)]);
    expect(await w.control.findArtifacts({ organizationId: ORG, debugIds: [], release: 'web@1.0.0' })).toEqual([first]);
    expect(await w.control.findArtifacts({ organizationId: ORG, debugIds: [], release: 'web@1.0.1' })).toEqual([elsewhere]);
  });

  it("keeps an Artifact within the token's Organization", async () => {
    const w = world();
    const other = await issueToken(w, 'other', { organizationId: OTHER_ORG, scopes: CI_TOKEN_SCOPES });
    const artifact = await uploadArtifact(sourceMap(), other, w);
    if (isRefusal(artifact)) throw new Error(artifact.refusal);
    expect(await w.control.findArtifacts({ organizationId: ORG, debugIds: [], release: 'web@1.0.0' })).toEqual([]);
    expect(await w.control.findArtifacts({ organizationId: OTHER_ORG, debugIds: [], release: 'web@1.0.0' })).toEqual([artifact]);
  });

  it('refuses a token without the release scope, and an unplaced upload, storing nothing', async () => {
    const w = world();
    const reader = await issueToken(w, 'reader', { scopes: ['event:read'] });
    const ci = await issueToken(w, 'ci', { scopes: CI_TOKEN_SCOPES });

    expect(await uploadArtifact(sourceMap(), reader, w)).toEqual({ refusal: 'scope-missing' });
    expect(await uploadArtifact(sourceMap({ release: null }), ci, w)).toEqual({ refusal: 'artifact-unplaced' });
    expect(w.blobs.blobs.size).toBe(0);
    expect(w.control.artifacts).toEqual([]);
  });

  it('refuses, indexing nothing, when the bytes cannot be stored', async () => {
    const w = world();
    const ci = await issueToken(w, 'ci', { scopes: CI_TOKEN_SCOPES });
    w.blobs.failure = { retryable: true };
    expect(await uploadArtifact(sourceMap(), ci, w)).toEqual({ refusal: 'artifact-not-stored' });
    expect(w.control.artifacts).toEqual([]);
  });
});
