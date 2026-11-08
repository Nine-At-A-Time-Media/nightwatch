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

// --- helpers ---

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The slug a Project's Short Ids carry: its own, or, while it has none, the
 * letters and digits of its id, led by `P` when they do not start with a
 * letter, so the Short Id always matches the grammar.
 */
export function shortIdSlug({ projectId, slug }: { projectId: string; slug: string | null }): string {
  if (slug !== null) return slug;
  const letters = projectId.replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z]/.test(letters) ? letters : `P${letters}`;
}

/** The Short Id for a Project's issue counter, e.g. slug `web`, counter 32 -> `WEB-10`. */
export function formatShortId({ slug, counter }: { slug: string; counter: number }): ShortId {
  let suffix = '';
  let rest = counter;
  do {
    suffix = (BASE32[rest % 32] ?? '0') + suffix;
    rest = Math.floor(rest / 32);
  } while (rest > 0);
  return `${slug.toUpperCase()}-${suffix}`;
}

/** The counter a Short Id names. */
export function shortIdNumber(id: ShortId): number {
  const suffix = id.slice(id.lastIndexOf('-') + 1);
  return [...suffix].reduce((n, ch) => n * 32 + BASE32.indexOf(ch), 0);
}
