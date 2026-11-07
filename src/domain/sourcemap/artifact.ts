/**
 * Artifact matching -- which uploaded Artifact maps a frame (design Domain
 * Language, Artifact: matched by debug id before release and file name).
 * A `sourcemap` debug image ties the frame's bundle URL to a debug id; with
 * no debug id match, an Artifact of the Event's release whose normalized
 * file name is the frame's, or the frame's with `.map`, matches.
 */

import type { DebugImage, Frame } from '../normalize/normalized-event.js';

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

// --- helpers ---

function normalizedDebugId(id: string): string {
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
