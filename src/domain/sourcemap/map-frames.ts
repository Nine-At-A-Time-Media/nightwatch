/**
 * Frame mapping -- maps an Event's minified frames to original source
 * (design Processing, Source maps; Behaviors, Source map applied and Missing
 * source map). The caller's lookup gives the parsed source map of a frame's
 * matching Artifact, or null when none matches. A frame that cannot be
 * mapped keeps its minified values and the Event records why.
 */

import type { EventError, Frame, NormalizedEvent } from '../normalize/normalized-event.js';
import { applySourceMap, type SourceMap } from './source-map.js';

export type FrameMappingReason = 'missing-artifact' | 'no-mapping';

export type FrameMappingError = { readonly index: number; readonly reason: FrameMappingReason };

export type MappedFrames = { readonly frames: readonly Frame[]; readonly errors: readonly FrameMappingError[] };

/** The parsed source map of the Artifact matching a frame, or null when no Artifact matches. */
export type SourceMapLookup = (frame: Frame) => SourceMap | null;

type FrameResult = { readonly frame: Frame; readonly reason: FrameMappingReason | null };

// --- helpers ---

function mapFrame(frame: Frame, lookup: SourceMapLookup): FrameResult {
  const map = lookup(frame);
  if (map === null) return { frame, reason: 'missing-artifact' };
  const mapped = applySourceMap(frame, map);
  return mapped === null ? { frame, reason: 'no-mapping' } : { frame: mapped, reason: null };
}

function eventErrors(path: string, errors: readonly FrameMappingError[]): readonly EventError[] {
  return errors.map((error) => ({ path: `${path}.${error.index}`, reason: error.reason }));
}

// --- exports ---

export function mapFrames(frames: readonly Frame[], lookup: SourceMapLookup): MappedFrames {
  const results = frames.map((frame) => mapFrame(frame, lookup));
  return {
    frames: results.map((result) => result.frame),
    errors: results.flatMap((result, index) => (result.reason === null ? [] : [{ index, reason: result.reason }])),
  };
}

/** Maps every frame of the exception chain and the stack trace, recording each unmapped frame on the Event. */
export function mapEventFrames(event: NormalizedEvent, lookup: SourceMapLookup): NormalizedEvent {
  const exceptions = event.exceptions.map((exception) => mapFrames(exception.frames, lookup));
  const stacktrace = event.stacktrace === null ? null : mapFrames(event.stacktrace, lookup);
  return {
    ...event,
    exceptions: event.exceptions.map((exception, index) => ({ ...exception, frames: exceptions[index]?.frames ?? exception.frames })),
    stacktrace: stacktrace?.frames ?? null,
    errors: [
      ...event.errors,
      ...exceptions.flatMap((mapped, index) => eventErrors(`exceptions.${index}.frames`, mapped.errors)),
      ...(stacktrace === null ? [] : eventErrors('stacktrace', stacktrace.errors)),
    ],
  };
}
