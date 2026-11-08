/**
 * Commit references -- the Short Ids a Commit or pull request says it fixes
 * (design Code and GitHub, Resolve by reference; Behaviors: Resolve by
 * commit, the parsing part).
 *
 * A reference is a keyword (fix, fixes, fixed, close, closes, closed,
 * resolve, resolves, resolved; any case; a whole word), then a colon or
 * whitespace, then one or more Short Ids separated by commas, whitespace or
 * "and". The list ends at the first token that is not a Short Id. Ids are
 * returned once each, in the order they first appear.
 */

import { SHORT_ID_PATTERN, type ShortId } from '../issue/short-id.js';

const KEYWORD = /(?<![A-Za-z0-9_])(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)(?![A-Za-z0-9_])/gi;
const LEAD = /(?::\s*|\s+)/y;
const SEPARATOR = /(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s+)/iy;
const SHORT_ID_TOKEN = new RegExp(`${SHORT_ID_PATTERN}(?![A-Za-z0-9_-])`, 'y');

// --- helpers ---

/** The match of a sticky pattern at `from`, or null. */
function matchAt(pattern: RegExp, text: string, from: number): RegExpExecArray | null {
  pattern.lastIndex = from;
  return pattern.exec(text);
}

/** The Short Ids listed from `from`, which is just after a keyword. */
function listedShortIds(text: string, from: number): ShortId[] {
  const ids: ShortId[] = [];
  const lead = matchAt(LEAD, text, from);
  let separator = lead;
  let at = from + (lead?.[0].length ?? 0);
  while (separator !== null) {
    const id = matchAt(SHORT_ID_TOKEN, text, at);
    if (id === null) break;
    ids.push(id[0]);
    at += id[0].length;
    separator = matchAt(SEPARATOR, text, at);
    at += separator?.[0].length ?? 0;
  }
  return ids;
}

// --- exports ---

export function fixedShortIds(text: string): ShortId[] {
  const ids = Array.from(text.matchAll(KEYWORD), (keyword) => listedShortIds(text, keyword.index + keyword[0].length));
  return [...new Set(ids.flat())];
}
