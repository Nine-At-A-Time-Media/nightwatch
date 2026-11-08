/**
 * Envelope -- the SDK wire container: a JSON header line, then items, each a
 * JSON header line and a payload. A payload with a declared length may hold
 * newlines; one without runs to the next newline.
 */

import { refusal, type Refusal } from '../refusal.js';

export type ItemHeader = { readonly type: string; readonly length?: number; readonly [key: string]: unknown };
export type EnvelopeItem = { readonly header: ItemHeader; readonly payload: Uint8Array };
export type Envelope = { readonly header: Readonly<Record<string, unknown>>; readonly items: readonly EnvelopeItem[] };

const NEWLINE = 0x0a;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function lineEnd(bytes: Uint8Array, from: number): number {
  const at = bytes.indexOf(NEWLINE, from);
  return at === -1 ? bytes.length : at;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isItemHeader(value: Record<string, unknown>): value is ItemHeader {
  return (
    typeof value['type'] === 'string' && (value['length'] === undefined || (typeof value['length'] === 'number' && value['length'] >= 0))
  );
}

export function parseEnvelope(bytes: Uint8Array): Envelope | Refusal {
  const headerEnd = lineEnd(bytes, 0);
  const header = parseJsonObject(bytes.subarray(0, headerEnd));
  if (!header) return refusal('malformed-envelope-header');
  const items: EnvelopeItem[] = [];
  let cursor = headerEnd + 1;
  while (cursor < bytes.length) {
    const itemHeaderEnd = lineEnd(bytes, cursor);
    const raw = bytes.subarray(cursor, itemHeaderEnd);
    cursor = itemHeaderEnd + 1;
    if (raw.length === 0) continue;
    const itemHeader = parseJsonObject(raw);
    if (!itemHeader || !isItemHeader(itemHeader)) return refusal('malformed-item-header');
    if (itemHeader.length !== undefined) {
      const end = cursor + itemHeader.length;
      if (end > bytes.length) return refusal('truncated-item');
      items.push({ header: itemHeader, payload: bytes.slice(cursor, end) });
      cursor = end + 1;
    } else {
      const end = lineEnd(bytes, cursor);
      items.push({ header: itemHeader, payload: bytes.slice(cursor, end) });
      cursor = end + 1;
    }
  }
  return { header, items };
}

export function serializeEnvelope(envelope: Envelope): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode(JSON.stringify(envelope.header) + '\n')];
  for (const item of envelope.items) {
    parts.push(encoder.encode(JSON.stringify({ ...item.header, length: item.payload.length }) + '\n'), item.payload, encoder.encode('\n'));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
