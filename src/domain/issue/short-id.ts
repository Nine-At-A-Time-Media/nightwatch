/**
 * Short Id -- the human-readable id of an Issue, unique within its Project
 * and never reused (design Domain Language: Short Id).
 *
 * The design names no spelling; this grammar is the one Nightwatch issues
 * and recognises: the Project's slug in capitals (a letter, then letters or
 * digits), a dash, and a suffix in Crockford base32 capitals (digits and
 * letters other than I, L, O and U), e.g. `WEB-3K`. Capitals only, so that
 * ordinary hyphenated words in commit text are never taken for one.
 */

/** A Short Id, such as `WEB-3K`. */
export type ShortId = string;

/** The Short Id grammar, without anchors, for embedding in a larger pattern. */
export const SHORT_ID_PATTERN = '[A-Z][A-Z0-9]*-[0-9A-HJKMNP-TV-Z]+';

const SHORT_ID = new RegExp(`^${SHORT_ID_PATTERN}$`);

// --- predicates ---

export function isShortId(text: string): text is ShortId {
  return SHORT_ID.test(text);
}
