/**
 * Source map -- a parsed source map and the lookup of one minified frame
 * through it (design Processing, Source maps). A thin wrapper over
 * `@jridgewell/trace-mapping`, which is pure computation: no I/O. Frame
 * lines and columns are 1-based as SDKs send them; the map's are 0-based.
 */

import { originalPositionFor, sourceContentFor, TraceMap, type EncodedSourceMap } from '@jridgewell/trace-mapping';
import { z } from 'zod';
import { refusal, type Refusal } from '../refusal.js';
import type { Frame } from '../normalize/normalized-event.js';

/** A parsed source map, ready for lookups. */
export type SourceMap = { readonly kind: 'source-map'; readonly trace: TraceMap };

const SOURCE_MAP_VERSION = 3;
const MAPPINGS_ALPHABET = /^[A-Za-z0-9+/,;]*$/;

const sourceMapSchema = z.object({
  version: z.literal(SOURCE_MAP_VERSION),
  file: z.string().nullish(),
  sourceRoot: z.string().nullish(),
  sources: z.array(z.string().nullable()),
  sourcesContent: z.array(z.string().nullable()).nullish(),
  names: z.array(z.string()).default([]),
  mappings: z.string().regex(MAPPINGS_ALPHABET),
});

// --- helpers ---

function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function contextLine(map: SourceMap, source: string, line: number): string | undefined {
  return sourceContentFor(map.trace, source)?.split('\n')[line - 1];
}

// --- exports ---

/** Parses a source map from its JSON text or its parsed JSON. */
export function parseSourceMap(raw: unknown): SourceMap | Refusal {
  const parsed = sourceMapSchema.safeParse(typeof raw === 'string' ? decode(raw) : raw);
  if (!parsed.success) return refusal('invalid-source-map');
  const { file, sourceRoot, sourcesContent, ...rest } = parsed.data;
  const encoded: EncodedSourceMap = {
    ...rest,
    file: file ?? null,
    sourceRoot: sourceRoot ?? '',
    ...(sourcesContent ? { sourcesContent } : {}),
  };
  try {
    return { kind: 'source-map', trace: new TraceMap(encoded) };
  } catch {
    return refusal('invalid-source-map');
  }
}

/** The frame at its original file, line, column and function; null when the map holds no position for it. */
export function applySourceMap(frame: Frame, map: SourceMap): Frame | null {
  if (frame.lineno === undefined || frame.colno === undefined || frame.lineno < 1 || frame.colno < 1) return null;
  const original = originalPositionFor(map.trace, { line: frame.lineno, column: frame.colno - 1 });
  if (original.source === null) return null;
  const line = contextLine(map, original.source, original.line);
  const fn = original.name ?? frame.function;
  return {
    ...frame,
    filename: original.source,
    absPath: original.source,
    lineno: original.line,
    colno: original.column + 1,
    ...(fn === undefined ? {} : { function: fn }),
    ...(line === undefined ? {} : { contextLine: line }),
  };
}
