import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeEvent, type NormalizedEvent } from '../../../../src/domain/normalize/normalize.js';
import type { Frame } from '../../../../src/domain/normalize/normalized-event.js';
import { isRefusal } from '../../../../src/domain/refusal.js';
import {
  artifactBlobKey,
  artifactQuery,
  isSourceMapped,
  matchArtifact,
  matchedArtifacts,
  normalizedFileName,
  sourceMapLookup,
  type Artifact,
} from '../../../../src/domain/sourcemap/artifact.js';
import { applySourceMap, parseSourceMap, type SourceMap } from '../../../../src/domain/sourcemap/source-map.js';
import { mapEventFrames, mapFrames } from '../../../../src/domain/sourcemap/map-frames.js';

// --- builders ---

const RECEIVED = new Date('2026-11-07T12:00:00Z');
const BUNDLE = 'https://cdn.example/static/app.min.js?v=3';
const DEBUG_ID = 'C0FFEE00-0000-4000-8000-000000000001';

/** Minified line 1: column 0 maps to cart.ts 1:0 `boot`; column 9 maps to cart.ts 5:2 `checkout`. */
const rawMap = {
  version: 3,
  file: 'app.min.js',
  sources: ['src/cart.ts'],
  sourcesContent: ['export function boot() {}\n\nexport function checkout() {\n  const total = sum();\n  pay(total);\n}\n'],
  names: ['boot', 'checkout'],
  mappings: 'AAAAA,SAIEC',
};

function sourceMap(raw: unknown = rawMap): SourceMap {
  const map = parseSourceMap(raw);
  if (isRefusal(map)) throw new Error(map.refusal);
  return map;
}

function minifiedError(): NormalizedEvent {
  const result = normalizeEvent(
    {
      event_id: 'd'.repeat(32),
      platform: 'javascript',
      release: 'web@1.0.0',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'n is not a function',
            stacktrace: {
              frames: [
                { abs_path: BUNDLE, filename: 'app.min.js', function: 'a', lineno: 1, colno: 1, in_app: true },
                { abs_path: BUNDLE, filename: 'app.min.js', function: 'b', lineno: 1, colno: 10, in_app: true },
              ],
            },
          },
        ],
      },
      debug_meta: { images: [{ type: 'sourcemap', code_file: BUNDLE, debug_id: DEBUG_ID }] },
    },
    { receivedAt: RECEIVED, clampFutureMs: 60_000, retentionMs: 86_400_000, projectId: 'p1', maxTagValueLength: 200 },
  );
  if (isRefusal(result)) throw new Error(result.refusal);
  return result;
}

const byDebugId: Artifact = { id: 'by-debug-id', debugId: DEBUG_ID.toLowerCase(), release: null, fileName: 'anything.js.map' };
const byRelease: Artifact = { id: 'by-release', debugId: null, release: 'web@1.0.0', fileName: '~/static/app.min.js.map' };
const otherRelease: Artifact = { id: 'other-release', debugId: null, release: 'web@0.9.0', fileName: '~/static/app.min.js.map' };

// --- behaviors ---

describe('source maps', () => {
  it('Source map applied: Given a matching Artifact was uploaded, When a minified browser error is processed, Then its frames show original file, line and function', () => {
    const event = minifiedError();
    const maps = new Map([['by-debug-id', sourceMap()]]);
    const scope = { debugImages: event.debugImages, release: event.release };
    const mapped = mapEventFrames(event, (frame) => {
      const artifact = matchArtifact(frame, scope, [otherRelease, byDebugId]);
      return artifact ? (maps.get(artifact.id) ?? null) : null;
    });
    expect(mapped.exceptions[0]?.frames).toEqual([
      {
        filename: 'src/cart.ts',
        absPath: 'src/cart.ts',
        function: 'boot',
        lineno: 1,
        colno: 1,
        inApp: true,
        contextLine: 'export function boot() {}',
      },
      {
        filename: 'src/cart.ts',
        absPath: 'src/cart.ts',
        function: 'checkout',
        lineno: 5,
        colno: 3,
        inApp: true,
        contextLine: '  pay(total);',
      },
    ]);
    expect(mapped.errors).toEqual([]);
  });

  it('Missing source map: Given no matching Artifact, When a minified error is processed, Then frames stay minified and the event records why', () => {
    const event = minifiedError();
    const mapped = mapEventFrames(event, () => null);
    expect(mapped.exceptions).toEqual(event.exceptions);
    expect(mapped.errors).toEqual([
      { path: 'exceptions.0.frames.0', reason: 'missing-artifact' },
      { path: 'exceptions.0.frames.1', reason: 'missing-artifact' },
    ]);
  });

  it('keeps a frame minified and records no-mapping when the map has no position for it', () => {
    const frames: readonly Frame[] = [
      { absPath: BUNDLE, function: 'z', lineno: 40, colno: 1 },
      { absPath: BUNDLE, function: 'y' },
    ];
    expect(mapFrames(frames, () => sourceMap())).toEqual({
      frames,
      errors: [
        { index: 0, reason: 'no-mapping' },
        { index: 1, reason: 'no-mapping' },
      ],
    });
  });

  it('maps a frame from a parsed map, and refuses a map that is not one', () => {
    expect(applySourceMap({ function: 'b', lineno: 1, colno: 10 }, sourceMap())).toMatchObject({
      function: 'checkout',
      lineno: 5,
      colno: 3,
    });
    expect(isRefusal(parseSourceMap({ version: 3, mappings: 'AAAA' }))).toBe(true);
    expect(isRefusal(parseSourceMap('not a map'))).toBe(true);
    expect(isRefusal(parseSourceMap({ ...rawMap, mappings: '!!!' }))).toBe(true);
  });

  it('never changes a frame when no Artifact matches, one missing-artifact error per frame', () => {
    const frame = fc.record({ function: fc.string({ maxLength: 6 }), lineno: fc.nat({ max: 99 }), colno: fc.nat({ max: 99 }) });
    fc.assert(
      fc.property(fc.array(frame, { maxLength: 10 }), (frames) => {
        const result = mapFrames(frames, () => null);
        expect(result.frames).toEqual(frames);
        expect(result.errors).toEqual(frames.map((_, index) => ({ index, reason: 'missing-artifact' })));
      }),
    );
  });
});

// --- Artifact matching ---

describe('matchArtifact', () => {
  const frame: Frame = { absPath: BUNDLE, lineno: 1, colno: 1 };
  const images = [{ type: 'sourcemap', codeFile: BUNDLE, debugId: DEBUG_ID }];

  it('matches by debug id before release and file name', () => {
    expect(matchArtifact(frame, { debugImages: images, release: 'web@1.0.0' }, [byRelease, byDebugId])).toBe(byDebugId);
  });

  it('falls back to the release and the normalized file name, the minified file or its map', () => {
    const scope = { debugImages: [], release: 'web@1.0.0' };
    expect(matchArtifact(frame, scope, [otherRelease, byRelease])).toBe(byRelease);
    const bundle: Artifact = { ...byRelease, id: 'bundle', fileName: '~/static/app.min.js' };
    expect(matchArtifact(frame, scope, [bundle])).toBe(bundle);
    expect(matchArtifact(frame, { debugImages: [], release: null }, [byRelease])).toBeNull();
    expect(matchArtifact(frame, { debugImages: images, release: 'web@2.0.0' }, [byRelease, otherRelease])).toBeNull();
  });

  it('normalizes file names to a path from the site root', () => {
    expect(normalizedFileName('https://cdn.example/static/app.js?v=1#top')).toBe('~/static/app.js');
    expect(normalizedFileName('app:///main.jsbundle')).toBe('~/main.jsbundle');
    expect(normalizedFileName('/static/app.js')).toBe('~/static/app.js');
    expect(normalizedFileName('~/static/app.js')).toBe('~/static/app.js');
  });

  it('a debug id match wins whatever release artifacts exist', () => {
    const artifact = fc.record({
      id: fc.string({ maxLength: 4 }),
      debugId: fc.constant(null),
      release: fc.constantFrom('web@1.0.0', null),
      fileName: fc.constantFrom('~/static/app.min.js', '~/static/app.min.js.map', '~/other.js'),
    });
    fc.assert(
      fc.property(fc.array(artifact, { maxLength: 6 }), fc.nat(), (others, at) => {
        const index = at % (others.length + 1);
        const artifacts = [...others.slice(0, index), byDebugId, ...others.slice(index)];
        expect(matchArtifact(frame, { debugImages: images, release: 'web@1.0.0' }, artifacts)).toBe(byDebugId);
      }),
    );
  });
});

// --- choosing and loading Artifacts for an Event ---

describe('Artifacts for an Event', () => {
  it('maps only browser events', () => {
    expect(isSourceMapped(minifiedError())).toBe(true);
    expect(isSourceMapped({ ...minifiedError(), platform: 'python' })).toBe(false);
  });

  it("asks the Artifact index by the Event's release and its source map debug ids", () => {
    expect(artifactQuery(minifiedError())).toEqual({ release: 'web@1.0.0', debugIds: [DEBUG_ID] });
  });

  it('keeps the Artifacts that match some frame, once each, and keys each by its id in the BlobStore', () => {
    const event = minifiedError();
    expect(matchedArtifacts(event, [otherRelease, byRelease, byDebugId])).toEqual([byDebugId]);
    expect(matchedArtifacts({ ...event, debugImages: [] }, [otherRelease, byRelease])).toEqual([byRelease]);
    expect(matchedArtifacts({ ...event, debugImages: [], release: null }, [byRelease])).toEqual([]);
    expect(artifactBlobKey(byRelease)).toBe('artifacts/by-release');
  });

  it('looks a frame up through the parsed map of its matching Artifact, or finds none', () => {
    const event = minifiedError();
    const frame = event.exceptions[0]?.frames[0] ?? {};
    const map = sourceMap();
    expect(sourceMapLookup({ event, artifacts: [byDebugId], maps: new Map([['by-debug-id', map]]) })(frame)).toBe(map);
    expect(sourceMapLookup({ event, artifacts: [byDebugId], maps: new Map() })(frame)).toBeNull();
    expect(sourceMapLookup({ event, artifacts: [], maps: new Map([['by-debug-id', map]]) })(frame)).toBeNull();
  });
});
