/**
 * outcomeTotals -- an operator views a Project's Outcomes over a Time Range
 * (design Behaviors: Outcome totals). Reads the archived Outcomes through
 * ArchiveQuery and sums them per kind and reason.
 *
 * Ports: ArchiveQuery.
 */

import type { ProjectId } from '../../domain/ids.js';
import { outcomeTotalsOf, type OutcomeTotals } from '../../domain/outcome/totals.js';
import type { TimeRange } from '../../domain/time-range.js';
import type { ArchiveQuery } from '../../ports/archive-query.js';

export type OutcomeTotalsDeps = { archive: ArchiveQuery };

// --- exports ---

export async function outcomeTotals(project: ProjectId, range: TimeRange, deps: OutcomeTotalsDeps): Promise<OutcomeTotals> {
  const outcomes = await deps.archive.outcomes({ projectId: project, range });
  return outcomeTotalsOf({ projectId: project, range, outcomes });
}
