/**
 * Grouping Version -- a named, immutable set of grouping rules (design Domain
 * Language). Its id is hashed into every Fingerprint, so two versions never
 * share one; a later version is a new value beside this one, never an edit.
 *
 * gv1, in order of precedence:
 *   1. An SDK fingerprint that holds a value other than the default token
 *      replaces derivation; with the default token it extends (salts) it.
 *   2. Else the first matching Fingerprint Rule, with the same semantics.
 *   3. Else the exception chain: each exception's type and contributing
 *      frames, its parameterized value only when no frame contributes. When
 *      any frame is in-app, an "app" Fingerprint over in-app frames only
 *      joins the "system" Fingerprint over all frames.
 *   4. Else the stack trace, with the same app and system split.
 *   5. Else the parameterized message (its template when known).
 *   6. Else one Fingerprint shared by every event with nothing to group on.
 * A frame contributes its module (else its normalized file name) and its
 * normalized function; with no function, its context line when no longer
 * than contextLineMaxLength. Line and column numbers never contribute.
 * Directly repeated frames count once.
 */

export type GroupingVersion = {
  readonly id: string;
  /** A longer context line is taken for minified code and does not contribute. */
  readonly contextLineMaxLength: number;
};

export const gv1: GroupingVersion = Object.freeze({ id: 'gv1', contextLineMaxLength: 120 });
