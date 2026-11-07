/**
 * ArchiveSink -- the seam for the analytical archive. Outcomes written here
 * are exact; Outcome totals are read from the archive.
 */

import type { Outcome } from '../domain/outcome/outcome.js';

export interface ArchiveSink {
  outcomes(outcomes: readonly Outcome[]): Promise<void>;
}
