/**
 * Cursor -- the opaque, URL-safe handle to where an Issue Page ended
 * (architecture use-case surface, searchIssues). It carries the sort, the
 * last Issue's sort key and Issue Id, and a digest of the Issue Query and
 * sort that issued it; it is valid only for that query and sort.
 *
 * Spelling: `<body>.<check>`, where body is the URL-safe base64 of a JSON
 * array `[version, sort, lastKey, lastId, digest]` and check is a prefix of
 * the FNV-1a hash of body. The check and digest are NOT cryptographic: a
 * Cursor grants nothing (every search re-resolves the viewer's Projects), so
 * they only have to turn an edited or stale Cursor into a Refusal rather
 * than a wrong page.
 */

import type { IssueId } from '../ids.js';
import { fnv1a128 } from '../grouping/fingerprint.js';
import { refusal, type Refusal } from '../refusal.js';
import { printIssueQuery, type IssueQuery } from './query.js';
import { isIssueSort, type IssueSort } from './sort.js';

/** An opaque Cursor, as it travels in a URL. */
export type Cursor = string;

/** What a Cursor names: where the previous page ended, in which order. */
export type CursorPosition = { readonly sort: IssueSort; readonly lastKey: number; readonly lastId: IssueId };

const VERSION = 1;
const DIGEST_LENGTH = 16;
const CHECK_LENGTH = 12;
const MAX_LENGTH = 2048;
const SPELLING = new RegExp(`^([A-Za-z0-9_-]+)\\.([0-9a-f]{${CHECK_LENGTH}})$`);
const UTF8 = new TextEncoder();
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

const BAD_CURSOR = 'search_bad_cursor';

// --- predicates ---

function isPayload(value: unknown): value is [number, string, number, string, string] {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    value[0] === VERSION &&
    typeof value[1] === 'string' &&
    Number.isFinite(value[2]) &&
    typeof value[3] === 'string' &&
    value[3] !== '' &&
    typeof value[4] === 'string'
  );
}

// --- helpers ---

function queryDigest({ query, sort }: { query: IssueQuery; sort: IssueSort }): string {
  return fnv1a128(`${sort} ${printIssueQuery(query)}`).slice(0, DIGEST_LENGTH);
}

function checkOf(body: string): string {
  return fnv1a128(body).slice(0, CHECK_LENGTH);
}

function toBase64Url(text: string): string {
  const binary = Array.from(UTF8.encode(text), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The JSON value a URL-safe base64 body spells, or null when it spells no UTF-8 JSON. */
function fromBase64Url(body: string): unknown {
  try {
    const binary = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(STRICT_UTF8.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))) as unknown;
  } catch {
    return null;
  }
}

// --- exports ---

export function encodeCursor({ sort, lastKey, lastId, query }: CursorPosition & { query: IssueQuery }): Cursor {
  const body = toBase64Url(JSON.stringify([VERSION, sort, lastKey, lastId, queryDigest({ query, sort })]));
  return `${body}.${checkOf(body)}`;
}

/** The position a Cursor names, or a Refusal when it is malformed or was issued for another query or sort. */
export function decodeCursor({ cursor, query, sort }: { cursor: Cursor; query: IssueQuery; sort: IssueSort }): CursorPosition | Refusal {
  const spelled = cursor.length <= MAX_LENGTH ? SPELLING.exec(cursor) : null;
  const [, body = '', check = ''] = spelled ?? [];
  if (!spelled || checkOf(body) !== check) return refusal(BAD_CURSOR);
  const payload = fromBase64Url(body);
  if (!isPayload(payload) || !isIssueSort(payload[1])) return refusal(BAD_CURSOR);
  const [, issuedSort, lastKey, lastId, digest] = payload;
  if (issuedSort !== sort || digest !== queryDigest({ query, sort })) return refusal('search_cursor_mismatch');
  return { sort: issuedSort, lastKey, lastId };
}
