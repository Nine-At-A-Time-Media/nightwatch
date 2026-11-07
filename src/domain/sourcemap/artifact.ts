/**
 * Artifact matching -- which uploaded Artifact maps a frame (design Domain
 * Language, Artifact: matched by debug id before release and file name).
 * A `sourcemap` debug image ties the frame's bundle URL to a debug id; with
 * no debug id match, an Artifact of the Event's release whose normalized
 * file name is the frame's, or the frame's with `.map`, matches.
 *
 * Also what processing needs around the match: whether an Event's frames
 * are mapped at all (browser events only), what to ask the Artifact index,
 * which Artifacts to load, where each is stored, and the frame lookup over
 * the loaded maps.
 */

import type { DebugImage, Frame, NormalizedEvent } from '../normalize/normalized-event.js';
import type { SourceMapLookup } from './map-frames.js';
import type { SourceMap } from './source-map.js';

/** An entry of the Artifact index: an uploaded source map or bundle. */
export type Artifact = {
  readonly id: string;
  readonly debugId: string | null;
  readonly release: string | null;
  /** The name it was uploaded under, such as `~/static/app.min.js.map`. */
  readonly fileName: string;
};

/** What of the Event decides the match besides the frame. */
export type ArtifactScope = { readonly debugImages: readonly DebugImage[]; readonly release: string | null };

/** What to ask the Artifact index for one Event: Artifacts of its release, or carrying one of its debug ids. */
export type ArtifactQuery = { readonly release: string | null; readonly debugIds: readonly string[] };

/** The platform of browser JavaScript, whose frames are minified and mapped. */
const BROWSER_PLATFORM = 'javascript';
const ARTIFACTS_PREFIX = 'artifacts/';

const SOURCE_MAP_IMAGE = 'sourcemap';
const MAP_SUFFIX = '.map';
const SCHEME_AND_HOST = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;
const SITE_ROOT = '~';

// --- predicates ---

function isSameDebugId(a: string, b: string): boolean {
  return normalizedDebugId(a) === normalizedDebugId(b);
}

function isFileMatch(artifact: Artifact, fileName: string): boolean {
  const name = normalizedFileName(artifact.fileName);
  return name === fileName || name === fileName + MAP_SUFFIX;
}

/** Only browser frames are mapped (design Processing, Source maps); other Events record nothing about source maps. */
export function isSourceMapped(event: NormalizedEvent): boolean {
  return event.platform === BROWSER_PLATFORM;
}

// --- helpers ---

/** A debug id compared without hyphens or case: the form the Artifact index keeps. */
export function normalizedDebugId(id: string): string {
  return id.replaceAll('-', '').toLowerCase();
}

function frameFile(frame: Frame): string | undefined {
  return frame.absPath ?? frame.filename;
}

function debugIdOf(file: string, images: readonly DebugImage[]): string | undefined {
  return images.find((image) => image.type === SOURCE_MAP_IMAGE && image.codeFile === file && image.debugId !== undefined)?.debugId;
}

// --- exports ---

/** A file URL or path as a path from the site root: `https://cdn/x/app.js?v=1` becomes `~/x/app.js`. */
export function normalizedFileName(file: string): string {
  const path = file.split(/[?#]/)[0] ?? '';
  if (path.startsWith(`${SITE_ROOT}/`)) return path;
  const withoutHost = path.replace(SCHEME_AND_HOST, '');
  return SITE_ROOT + (withoutHost.startsWith('/') ? withoutHost : `/${withoutHost}`);
}

export function matchArtifact(frame: Frame, scope: ArtifactScope, artifacts: readonly Artifact[]): Artifact | null {
  const file = frameFile(frame);
  if (file === undefined) return null;
  const debugId = debugIdOf(file, scope.debugImages);
  const byDebugId = debugId === undefined ? undefined : artifacts.find((a) => a.debugId !== null && isSameDebugId(a.debugId, debugId));
  if (byDebugId) return byDebugId;
  if (scope.release === null) return null;
  const fileName = normalizedFileName(file);
  return artifacts.find((a) => a.release === scope.release && isFileMatch(a, fileName)) ?? null;
}

export function artifactQuery(event: NormalizedEvent): ArtifactQuery {
  const debugIds = event.debugImages.flatMap((image) =>
    image.type === SOURCE_MAP_IMAGE && image.debugId !== undefined ? [image.debugId] : [],
  );
  return { release: event.release, debugIds };
}

function eventFrames(event: NormalizedEvent): readonly Frame[] {
  return [...event.exceptions.flatMap((exception) => exception.frames), ...(event.stacktrace ?? [])];
}

/** The Artifacts that match at least one of the Event's frames, once each, in the order first matched. */
export function matchedArtifacts(event: NormalizedEvent, artifacts: readonly Artifact[]): readonly Artifact[] {
  const scope = { debugImages: event.debugImages, release: event.release };
  const matched = eventFrames(event).flatMap((frame) => matchArtifact(frame, scope, artifacts) ?? []);
  return [...new Map(matched.map((artifact) => [artifact.id, artifact])).values()];
}

/** The BlobStore key an Artifact's file is stored under. */
export function artifactBlobKey(artifact: Artifact): string {
  return `${ARTIFACTS_PREFIX}${artifact.id}`;
}

/** Each frame's source map: that of its matching Artifact among the parsed `maps` (by Artifact id), or null. */
export function sourceMapLookup({
  event,
  artifacts,
  maps,
}: {
  event: NormalizedEvent;
  artifacts: readonly Artifact[];
  maps: ReadonlyMap<string, SourceMap>;
}): SourceMapLookup {
  const scope = { debugImages: event.debugImages, release: event.release };
  return (frame) => {
    const artifact = matchArtifact(frame, scope, artifacts);
    return artifact === null ? null : (maps.get(artifact.id) ?? null);
  };
}
