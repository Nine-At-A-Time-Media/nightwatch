/**
 * ArchiveQuery -- the seam for reading the analytical archive (architecture
 * Seams: Archive query). Basin SQL in production; locally, the R2 NDJSON
 * objects R2NdjsonArchiveSink wrote, since Basin SQL is remote only. An
 * answer may hold rolled-up rows, a quantity standing for several Outcomes.
 */

import type { ProjectId } from '../domain/ids.js';
import type { Outcome } from '../domain/outcome/outcome.js';
import type { TimeRange } from '../domain/time-range.js';

export interface ArchiveQuery {
  /** The Project's archived Outcomes recorded within the Time Range, in no particular order. */
  outcomes(query: { projectId: ProjectId; range: TimeRange }): Promise<readonly Outcome[]>;
}
