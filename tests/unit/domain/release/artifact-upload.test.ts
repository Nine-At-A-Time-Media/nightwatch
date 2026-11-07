import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { artifactKey, artifactOf, parseArtifactUpload, type ArtifactUpload } from '../../../../src/domain/release/artifact-upload.js';
import { isRefusal } from '../../../../src/domain/refusal.js';

const bytes = new Uint8Array([123, 125]);

function upload(overrides: Partial<ArtifactUpload> = {}): ArtifactUpload {
  return { release: 'web@1.0.0', debugId: null, fileName: '~/static/app.min.js.map', bytes, ...overrides };
}

describe('parseArtifactUpload', () => {
  it('accepts an upload to a release, by debug id, or both', () => {
    expect(parseArtifactUpload(upload())).toEqual(upload());
    expect(parseArtifactUpload(upload({ release: null, debugId: 'abc' }))).toEqual(upload({ release: null, debugId: 'abc' }));
  });

  it('keeps a debug id in normalized form, so the index finds it however it was written', () => {
    expect(parseArtifactUpload(upload({ debugId: 'C0FFEE00-1111-2222' }))).toEqual(upload({ debugId: 'c0ffee0011112222' }));
  });

  it('refuses an upload with no release and no debug id, no file name, or no content', () => {
    expect(parseArtifactUpload(upload({ release: null }))).toEqual({ refusal: 'artifact-unplaced' });
    expect(parseArtifactUpload(upload({ release: '' }))).toEqual({ refusal: 'artifact-unplaced' });
    expect(parseArtifactUpload(upload({ fileName: '' }))).toEqual({ refusal: 'artifact-unnamed' });
    expect(parseArtifactUpload(upload({ bytes: new Uint8Array() }))).toEqual({ refusal: 'artifact-empty' });
  });

  it('accepts exactly the uploads that are placed, named and not empty', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string(), { nil: null }),
        fc.option(fc.string(), { nil: null }),
        fc.string(),
        fc.uint8Array(),
        (release, debugId, fileName, content) => {
          const placed = Boolean(release) || Boolean(debugId);
          const ok = placed && fileName !== '' && content.length > 0;
          return isRefusal(parseArtifactUpload({ release, debugId, fileName, bytes: content })) === !ok;
        },
      ),
    );
  });
});

describe('artifactOf and artifactKey', () => {
  it('names an Artifact by its content hash and keeps its bytes under that hash', () => {
    expect(artifactOf(upload({ debugId: 'abc' }), 'c0ffee')).toEqual({
      id: 'c0ffee',
      debugId: 'abc',
      release: 'web@1.0.0',
      fileName: '~/static/app.min.js.map',
    });
    expect(artifactKey('c0ffee')).toBe('artifacts/c0ffee');
  });
});
