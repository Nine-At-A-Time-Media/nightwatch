/**
 * Ids -- the seam for fresh unique identifiers. Real ids come from the
 * runtime's random source; tests use a deterministic sequence.
 */

export interface Ids {
  newId(): string;
}
